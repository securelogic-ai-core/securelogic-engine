/**
 * assetAutoCreation.ts — PLAT-ASSET-1 v1: deterministic resolve-or-create for
 * strong asset identities, and the review-queue writer.
 *
 * THE OPERATOR RULING (2026-08-22), implemented end to end:
 *   * a source asset with a qualified strong identity (assetStrongIdentity.ts
 *     — the allowlist) AUTO-CREATES a canonical asset when nothing carries
 *     that identity yet;
 *   * an exact strong match ATTACHES to the existing asset and refreshes
 *     identifier freshness (the 20261049 column-level grant);
 *   * ambiguity NEVER guesses — it queues for a human;
 *   * two existing canonical assets are NEVER merged, nothing is ever
 *     deleted, and every creation is durably provenanced (asset_origins) and
 *     audited (security_audit_log).
 *
 * THE CROSS-LANE BRIDGE (architect-mandated, v1-critical): the connector lane
 * already knows ARNs / ARM ids / GCP names — but only as
 * cloud_resources.external_ref, invisible to asset_identifiers resolution.
 * Without a bridge, the first scan import on an org with connector-synced
 * assets would duplicate its whole cloud estate. So a qualified-strong value
 * that misses the alias index is checked against cloud_resources
 * (org, external_ref) before any creation; a hit is an ATTACH — and the
 * alias row is backfilled so the bridge is crossed once per asset, not once
 * per import. A backing row whose registry pointer was lost (asset_id NULL,
 * the documented dark-window state) is repaired via registerAsset, which is
 * idempotent by design.
 *
 * CONCURRENCY: creation is serialized per identity with
 * pg_advisory_xact_lock over hash(org:scheme:normalizedValue) — two
 * concurrent imports of the same ARN produce exactly one asset, with no
 * unique-index carve-out (architect ruling A: 20261033's "an identifier does
 * not uniquely determine an asset" stands unmodified; the lock guards the
 * only automatic writer, and a duplicate strong claim from any future
 * non-locking writer degrades to `ambiguous` → human, exactly as designed).
 * Locks are transaction-scoped and accumulate across an import, so THE
 * CALLER MUST PROCESS CREATE-CANDIDATES IN SORTED normalizedValue ORDER
 * (vulnerabilityScanIntake.ts does) — unordered acquisition across two
 * concurrent imports is the classic deadlock.
 *
 * FLAG DISCIPLINE: this module writes nothing unless
 * SECURELOGIC_ASSET_AUTO_CREATE_ENABLED **and**
 * SECURELOGIC_ASSET_REGISTRY_ENABLED are both on — the latter because
 * createDetailAsset's documented invariant is that detail rows are only
 * created where the registry is enabled, and this lane keeps that invariant.
 * The caller checks autoCreationActive() ONCE and stays on the SL-OCC-3
 * ship-behavior when it is false.
 *
 * TENANCY: runs inside the caller's asTenant scope; every statement is
 * org-scoped by parameter on top of RLS.
 */

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "./auditLog.js";
import { assetAutoCreateEnabled } from "./assetAutoCreateFlag.js";
import { assetRegistryEnabled } from "./assetRegistryFeatureFlag.js";
import { registerAsset } from "./assetRegistrar.js";
import { createDetailAsset } from "./assetDetailPersistence.js";
import {
  STRONG_IDENTITY_SCHEME,
  type StrongIdentity
} from "./assetStrongIdentity.js";

/** Both flags — see FLAG DISCIPLINE above. */
export function autoCreationActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return assetAutoCreateEnabled(env) && assetRegistryEnabled(env);
}

export interface AutoCreationContext {
  organizationId: string;
  sourceKey: string;
  scanRunId: string;
  externalRunId: string;
  actorUserId: string | null;
  actorApiKeyId: string | null;
}

export type StrongResolutionOutcome =
  | { status: "attached"; assetId: string; via: "alias" | "bridge" }
  | { status: "created"; assetId: string }
  | { status: "queued"; kind: "ambiguous"; candidateCount: number; candidateIds: string[] }
  | { status: "cap_exceeded" }
  /** Both deterministic name candidates collided with unrelated rows — a
   *  state so unusual it is counted and named, never silently absorbed. */
  | { status: "creation_conflict" };

/** Validation-cap parity with the registry create surface (MAX_NAME). */
const MAX_NAME = 200;

function boundedName(candidate: string): string {
  return candidate.length <= MAX_NAME ? candidate : candidate.slice(0, MAX_NAME);
}

/**
 * Queue an identifier for human review. Idempotent against the pending
 * partial unique index — replaying a report never floods the queue; a
 * dismissed row may legitimately be re-asked by a later import. Returns the
 * review id when a NEW row was created, null when a pending row already
 * stood (or the insert raced one).
 *
 * The queue row is itself the durable record of the deferral decision — no
 * separate audit event per row (the import writes one summary event; see the
 * package doc's audit-scope ruling).
 */
export async function queueResolutionReview(
  ctx: AutoCreationContext,
  kind: "ambiguous" | "conflicting_identity" | "unqualified_strong",
  scheme: string,
  value: string,
  candidateAssetIds: readonly string[],
  claimsEcho: Record<string, unknown> | null
): Promise<string | null> {
  const inserted = await pg.query<{ id: string }>(
    `INSERT INTO asset_resolution_reviews
       (organization_id, kind, scheme, value, source_key, scan_run_id,
        candidate_asset_ids, claims_echo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (organization_id, source_key, scheme, value)
       WHERE accepted_at IS NULL AND dismissed_at IS NULL
       DO NOTHING
     RETURNING id`,
    [
      ctx.organizationId,
      kind,
      scheme,
      value,
      ctx.sourceKey,
      ctx.scanRunId,
      [...candidateAssetIds],
      claimsEcho == null ? null : JSON.stringify(claimsEcho)
    ]
  );
  return inserted.rows[0]?.id ?? null;
}

/** Refresh identifier freshness — the whole extent of the 20261049 grant. */
async function touchAlias(
  organizationId: string,
  value: string
): Promise<void> {
  await pg.query(
    `UPDATE asset_identifiers
        SET last_seen_at = NOW(), updated_at = NOW()
      WHERE organization_id = $1 AND scheme = $2 AND value = $3`,
    [organizationId, STRONG_IDENTITY_SCHEME, value]
  );
}

/** Assert the alias in the index. ON CONFLICT: the same source re-asserting
 *  the same identity is one fact, not an error. */
async function assertAlias(
  organizationId: string,
  assetId: string,
  value: string,
  sourceKey: string
): Promise<void> {
  await pg.query(
    `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, asset_id, scheme, value) DO NOTHING`,
    [organizationId, assetId, STRONG_IDENTITY_SCHEME, value, sourceKey]
  );
}

/** The cross-lane bridge: does the connector/registry lane already know this
 *  identity as a cloud_resources.external_ref? Exact match always; Azure
 *  additionally case-insensitive (ARM ids are; the connector may have stored
 *  mixed case). */
async function bridgeLookup(
  organizationId: string,
  identity: StrongIdentity
): Promise<{ backingId: string; assetId: string | null } | null> {
  const rows = await pg.query<{ id: string; asset_id: string | null }>(
    identity.provider === "azure"
      ? `SELECT id, asset_id FROM cloud_resources
          WHERE organization_id = $1 AND LOWER(external_ref) = $2`
      : `SELECT id, asset_id FROM cloud_resources
          WHERE organization_id = $1 AND external_ref = $2`,
    [organizationId, identity.normalizedValue]
  );
  const row = rows.rows[0];
  return row == null ? null : { backingId: row.id, assetId: row.asset_id };
}

async function attachViaBridge(
  ctx: AutoCreationContext,
  identity: StrongIdentity,
  bridge: { backingId: string; assetId: string | null }
): Promise<StrongResolutionOutcome> {
  // Registry pointer lost (documented dark-window state) → idempotent repair.
  const assetId =
    bridge.assetId ??
    (await registerAsset(
      ctx.organizationId,
      "cloud_resource",
      "cloud_resources",
      bridge.backingId
    ));
  await assertAlias(ctx.organizationId, assetId, identity.normalizedValue, ctx.sourceKey);
  await touchAlias(ctx.organizationId, identity.normalizedValue);
  return { status: "attached", assetId, via: "bridge" };
}

/**
 * Resolve a QUALIFIED strong identity to exactly one asset — attaching,
 * creating, or queueing — under the per-identity advisory lock. The caller
 * has already classified the claim (assetStrongIdentity.ts) and verified
 * autoCreationActive().
 */
export async function resolveOrCreateStrongAsset(
  ctx: AutoCreationContext,
  identity: StrongIdentity
): Promise<StrongResolutionOutcome> {
  // Serialize per (org, scheme, normalized value). hashtextextended → bigint,
  // the advisory-lock keyspace. Transaction-scoped: released at commit.
  await pg.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `${ctx.organizationId}:${STRONG_IDENTITY_SCHEME}:${identity.normalizedValue}`
  ]);

  // 1. The alias index — the canonical resolution path.
  const alias = await pg.query<{ asset_id: string }>(
    `SELECT DISTINCT asset_id FROM asset_identifiers
      WHERE organization_id = $1 AND scheme = $2 AND value = $3`,
    [ctx.organizationId, STRONG_IDENTITY_SCHEME, identity.normalizedValue]
  );
  if (alias.rows.length === 1) {
    await touchAlias(ctx.organizationId, identity.normalizedValue);
    return { status: "attached", assetId: alias.rows[0]!.asset_id, via: "alias" };
  }
  if (alias.rows.length > 1) {
    // Two canonical assets claim one globally-unique identity. The machine
    // may not pick and may NEVER merge — a human decides (operator ruling).
    const candidateIds = alias.rows.map((r) => r.asset_id);
    await queueResolutionReview(
      ctx,
      "ambiguous",
      STRONG_IDENTITY_SCHEME,
      identity.normalizedValue,
      candidateIds,
      null
    );
    return {
      status: "queued",
      kind: "ambiguous",
      candidateCount: candidateIds.length,
      candidateIds
    };
  }

  // 2. The cross-lane bridge.
  const bridge = await bridgeLookup(ctx.organizationId, identity);
  if (bridge != null) return attachViaBridge(ctx, identity, bridge);

  // 3. Nothing knows this identity — create, deterministically.
  const attempt = async (name: string) =>
    createDetailAsset(ctx.organizationId, {
      asset_type: "cloud_resource",
      name,
      criticality: null,
      status: "active",
      external_ref: identity.normalizedValue,
      typed: {
        provider: identity.provider,
        account_id: identity.accountId,
        region: identity.region,
        resource_type: identity.resourceType
      }
    });

  let created = await attempt(boundedName(identity.derivedName));
  if ("error" in created && created.error === "name_already_exists") {
    // A different asset owns the short name (two `web01`s across providers is
    // ordinary). The full identifier is collision-free by construction —
    // unless its external_ref existed, which the bridge already handled.
    created = await attempt(boundedName(identity.normalizedValue));
  }
  if ("error" in created) {
    if (created.error === "cap_exceeded") return { status: "cap_exceeded" };
    if (created.error === "external_ref_already_exists") {
      // Raced a writer outside our lock (manual create / connector sync).
      // The identity now exists — attach to it; losing this race is success.
      const rebridge = await bridgeLookup(ctx.organizationId, identity);
      if (rebridge != null) return attachViaBridge(ctx, identity, rebridge);
    }
    return { status: "creation_conflict" };
  }

  await assertAlias(ctx.organizationId, created.assetId, identity.normalizedValue, ctx.sourceKey);
  await pg.query(
    `INSERT INTO asset_origins
       (organization_id, asset_id, created_via, source_key, external_run_id,
        scan_run_id, scheme, value)
     VALUES ($1, $2, 'scan_import', $3, $4, $5, $6, $7)
     ON CONFLICT (asset_id) DO NOTHING`,
    [
      ctx.organizationId,
      created.assetId,
      ctx.sourceKey,
      ctx.externalRunId,
      ctx.scanRunId,
      STRONG_IDENTITY_SCHEME,
      identity.normalizedValue
    ]
  );

  // Per-creation audit event (architect audit-scope ruling: creations yes,
  // attaches no — attach evidence lives in the run's observation ledger).
  writeAuditEvent({
    organizationId: ctx.organizationId,
    actorApiKeyId: ctx.actorApiKeyId,
    actorUserId: ctx.actorUserId,
    eventType: "asset.auto_created",
    resourceType: "asset",
    resourceId: created.assetId,
    payload: {
      created_via: "scan_import",
      scheme: STRONG_IDENTITY_SCHEME,
      value: identity.normalizedValue,
      provider: identity.provider,
      source_key: ctx.sourceKey,
      scan_run_id: ctx.scanRunId,
      external_run_id: ctx.externalRunId
    }
  });

  return { status: "created", assetId: created.assetId };
}
