/**
 * tenantAssetResolver.ts — Canonical Product → Tenant Asset resolver (Enterprise
 * Risk Graph convergence, Phase C2b). DARK: no live caller.
 *
 * A reusable, ORGANIZATION-SCOPED, SOURCE-AGNOSTIC resolver: given a normalized
 * Canonical Product identity (from any source — CVE feed, advisory, SBOM), it
 * finds the tenant's own assets that are instances of that product. It produces
 * CANDIDATES for the ONE applicability engine (ApplicabilityEngineV1) — it does
 * NOT itself decide applicability, create a second engine, or write anything.
 *
 * Rulings enforced here:
 *   R1 — resolution targets the tenant ASSET (impact attaches to assets, not to
 *        vendors/products).
 *   R2 — resolves on the PRODUCT identity, never on vendor identity alone. A
 *        non-identifiable (vendor-only) input, or a product with no name to match
 *        (e.g. CVE-only, pending CPE/SBOM resolution), yields `needs_review` — it
 *        NEVER asserts a match, so it can never seed an `affected`.
 *
 * Tenant safety: the ONLY query filters `organization_id = $org` over that org's
 * ACTIVE registry assets. No cross-org fallback, no global asset lookup. A
 * deleted/retired asset is simply absent (status/active filter) — the resolver
 * degrades to `no_match`, never to another org's asset.
 *
 * Ambiguity is EXPLICIT: >1 active asset matching the product → `ambiguous`
 * (downstream maps this to a human `needs_review`, never an auto-decision).
 */

import type { PoolClient } from "pg";
import { canonicalizeVendorName } from "./vendorNameCanonical.js";
import type { CanonicalProductIdentity } from "./canonicalProduct.js";

export const TENANT_ASSET_RESOLVER_VERSION = "tar-v2.0.0";

/**
 * Confidence by PROVENANCE of the asset→product identity (ADR-0003 D1).
 *
 * These numbers are the evidence gate. ApplicabilityEngineV1's
 * `matchThresholds.high` is 70 (applicabilityPolicy.ts) — so everything at or above
 * 70 can support `affected`, and everything below it CANNOT, no matter how tidy the
 * string match looked.
 *
 *   attestation 100 — a human explicitly declared it (ADR-0003 D1-B override)
 *   sbom         95 — component evidence
 *   connector    85 — a discovery connector observed it
 *   inferred     60 — the asset's NAME happens to canonicalize to the product name.
 *                     BELOW the high threshold, deliberately: "we own something called
 *                     Exchange" is a coincidence, not evidence. It can raise
 *                     `potentially_affected`, never `affected` (ERG R2). This is the
 *                     single most important number in the file — before C4 this match
 *                     scored 100 and would have asserted `affected` on a name.
 */
export const IDENTITY_CONFIDENCE: Record<string, number> = {
  attestation: 100,
  sbom: 95,
  connector: 85,
  inferred: 60,
};

/** Authority order — a human attestation outranks machine evidence for the same asset. */
const PROVENANCE_RANK: Record<string, number> = {
  attestation: 0,
  sbom: 1,
  connector: 2,
  inferred: 3,
};

export type ResolutionStatus = "resolved" | "ambiguous" | "no_match" | "needs_review";

export interface ResolvedAssetCandidate {
  asset_id: string;
  asset_type: string;
  name: string;
  /** Human-readable why-matched, persisted as evidence rationale downstream. */
  match_rationale: string;
  /** 0–100; the engine consumes this as match evidence, never as the decision. */
  confidence: number;
  /** Which product identifiers drove the match (for evidence provenance). */
  source_identifiers: string[];
}

export interface AssetResolution {
  resolver_version: string;
  status: ResolutionStatus;
  /** Machine-readable reason code (audit + telemetry). */
  reason: string;
  candidates: ResolvedAssetCandidate[];
}

/**
 * Resolve a Canonical Product identity to the org's tenant assets. Read-only,
 * org-scoped. Returns candidates + an explicit status; never throws on empty.
 */
/** Recover the provenance token the candidate was built with (for ranking only). */
function provenanceOf(c: ResolvedAssetCandidate): string {
  const tag = c.source_identifiers.find((s) => s.startsWith("provenance:"));
  return tag ? tag.slice("provenance:".length) : "inferred";
}

export async function resolveTenantAssets(
  client: PoolClient,
  organizationId: string,
  identity: CanonicalProductIdentity
): Promise<AssetResolution> {
  const base = { resolver_version: TENANT_ASSET_RESOLVER_VERSION };

  // R2: a vendor-only / non-identifiable input is not a product — never resolve.
  if (!identity.identifiable) {
    return { ...base, status: "needs_review", reason: "not_product_identifiable", candidates: [] };
  }
  // A CVE-only identity (no product name) cannot name-match a tenant asset; CPE /
  // SBOM resolution is deferred. Honest `needs_review` — never an asserted match.
  if (!identity.product_canonical) {
    return { ...base, status: "needs_review", reason: "no_product_name_for_asset_match", candidates: [] };
  }

  const sourceIdentifiers = [
    `product_canonical:${identity.product_canonical}`,
    ...(identity.cve ? [`cve:${identity.cve}`] : []),
  ];

  // ── PATH 1: EVIDENCE ────────────────────────────────────────────────────────
  // What evidence says this org's assets actually RUN (asset_product_identities,
  // 20260905). ORG-SCOPED. Joined to canonical_products on product_canonical rather
  // than canonical_key, because canonical_key embeds the CVE — and an asset runs a
  // PRODUCT regardless of which vulnerability is being assessed today.
  const evidenceRows = await client.query<{
    asset_id: string;
    asset_type: string;
    name: string;
    provenance: string;
    confidence: number;
    evidence_ref: string | null;
  }>(
    `SELECT DISTINCT ON (api.asset_id)
            api.asset_id, rv.asset_type, rv.name,
            api.provenance, api.confidence, api.evidence_ref
       FROM asset_product_identities api
       JOIN canonical_products cp
         ON cp.id = api.canonical_product_id
       JOIN asset_registry_v rv
         ON rv.asset_id = api.asset_id AND rv.organization_id = api.organization_id
      WHERE api.organization_id = $1
        AND cp.product_canonical = $2
        AND ($3::text IS NULL OR cp.vendor_canonical IS NULL OR cp.vendor_canonical = $3)
        AND rv.status = 'active'
      ORDER BY api.asset_id,
               CASE api.provenance
                 WHEN 'attestation' THEN 0 WHEN 'sbom' THEN 1
                 WHEN 'connector'   THEN 2 ELSE 3 END,
               api.confidence DESC`,
    [organizationId, identity.product_canonical, identity.vendor_canonical]
  );

  const byAsset = new Map<string, ResolvedAssetCandidate>();
  for (const r of evidenceRows.rows) {
    byAsset.set(r.asset_id, {
      asset_id: r.asset_id,
      asset_type: r.asset_type,
      name: r.name,
      match_rationale: `asset_product_identity(${r.provenance})${r.evidence_ref ? `: ${r.evidence_ref}` : ""}`,
      confidence: r.confidence,
      source_identifiers: [...sourceIdentifiers, `provenance:${r.provenance}`],
    });
  }

  // ── PATH 2: NAME INFERENCE (weak, and scored as weak) ───────────────────────
  // The legacy behaviour, retained as a FALLBACK and no longer trusted as evidence.
  // Before C4 this scored 100 and would have asserted `affected` purely because an
  // asset's name canonicalized to the product's name. It is now scored below the
  // engine's `high` match threshold, so on its own it can only ever raise
  // `potentially_affected` (ERG R2: never assert `affected` without real evidence).
  // An asset that ALSO has evidence keeps its stronger evidence-backed candidate.
  const nameRows = await client.query<{ asset_id: string; asset_type: string; name: string }>(
    `SELECT a.id AS asset_id, rv.asset_type, rv.name
       FROM assets a
       JOIN asset_registry_v rv
         ON rv.asset_id = a.id AND rv.organization_id = a.organization_id
      WHERE a.organization_id = $1
        AND rv.status = 'active'`,
    [organizationId]
  );

  for (const r of nameRows.rows) {
    if (byAsset.has(r.asset_id)) continue; // evidence already speaks for this asset
    if (canonicalizeVendorName(r.name) !== identity.product_canonical) continue;
    byAsset.set(r.asset_id, {
      asset_id: r.asset_id,
      asset_type: r.asset_type,
      name: r.name,
      match_rationale: "inferred: asset_name_canonical == product_canonical (no evidence)",
      confidence: IDENTITY_CONFIDENCE.inferred!,
      source_identifiers: [...sourceIdentifiers, "provenance:inferred"],
    });
  }

  const candidates: ResolvedAssetCandidate[] = [...byAsset.values()].sort(
    (a, b) =>
      (PROVENANCE_RANK[provenanceOf(a)] ?? 9) - (PROVENANCE_RANK[provenanceOf(b)] ?? 9) ||
      b.confidence - a.confidence
  );

  if (candidates.length === 0) {
    return { ...base, status: "no_match", reason: "no_active_asset_matches_product", candidates: [] };
  }
  if (candidates.length > 1) {
    // Explicit ambiguity → human review; never auto-pick one asset.
    return { ...base, status: "ambiguous", reason: "multiple_active_assets_match_product", candidates };
  }
  return { ...base, status: "resolved", reason: "single_active_asset_match", candidates };
}
