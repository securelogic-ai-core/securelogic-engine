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

export const TENANT_ASSET_RESOLVER_VERSION = "tar-v1.0.0";

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

  // ORG-SCOPED, active assets only. No cross-org, no global lookup.
  const rows = await client.query<{ asset_id: string; asset_type: string; name: string }>(
    `SELECT a.id AS asset_id, a.asset_type, rv.name
       FROM assets a
       JOIN asset_registry_v rv
         ON rv.asset_id = a.id AND rv.organization_id = a.organization_id
      WHERE a.organization_id = $1
        AND rv.status = 'active'`,
    [organizationId]
  );

  const sourceIdentifiers = [
    `product_canonical:${identity.product_canonical}`,
    ...(identity.cve ? [`cve:${identity.cve}`] : []),
  ];

  const candidates: ResolvedAssetCandidate[] = rows.rows
    .filter((r) => canonicalizeVendorName(r.name) === identity.product_canonical)
    .map((r) => ({
      asset_id: r.asset_id,
      asset_type: r.asset_type,
      name: r.name,
      match_rationale: "asset_name_canonical == product_canonical",
      confidence: 100, // normalize-then-EXACT match; the engine gates 'affected' (R2)
      source_identifiers: sourceIdentifiers,
    }));

  if (candidates.length === 0) {
    return { ...base, status: "no_match", reason: "no_active_asset_matches_product", candidates: [] };
  }
  if (candidates.length > 1) {
    // Explicit ambiguity → human review; never auto-pick one asset.
    return { ...base, status: "ambiguous", reason: "multiple_active_assets_match_product", candidates };
  }
  return { ...base, status: "resolved", reason: "single_active_asset_match", candidates };
}
