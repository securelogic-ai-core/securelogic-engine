/**
 * enterpriseImportPersistence.ts — the shared persistence half of the ECL
 * import path, extracted from routes/enterpriseContextImport.ts in EAR Phase 3b
 * so the connector sync worker persists through the SAME lane as CSV import
 * ("extend, don't duplicate" — planImport stays the single planning truth).
 *
 * All functions run on the tenant `pg` proxy — callers wrap in asTenant
 * (route) or withTenant (worker). Every query is explicitly org-scoped.
 *
 * Phase 3b fixes folded in (both dark behind the ECL flag):
 *   - `identity` joined ENTERPRISE_TYPES: identity rows persist to
 *     enterprise_entities, so their dedup keys + cap must read
 *     enterprise_entities / max_enterprise_entities — previously they fell
 *     through to the ai_systems/monitored-entities branch (latent R7 bug).
 *   - enterprise-entity inserts persist `external_ref` — the validators have
 *     always normalized it (it is the connector re-sync dedup key); the CSV
 *     route silently dropped it.
 */

import { pg } from "../infra/postgres.js";
import { enforceEnterpriseEntityLimit } from "./enterpriseEntityLimit.js";
import { enforceEntityLimit } from "./entityLimit.js";
import { registerAsset } from "./assetRegistrar.js";
import { assetRegistryEnabled } from "./assetRegistryFeatureFlag.js";
import { entityTypeToAssetType } from "./assetRegistry.js";
import type { ImportEntityType, NormalizedImportInput } from "./enterpriseContextImport.js";

/** Import types persisted to enterprise_entities (the rest: vendor → vendors, ai_system → ai_systems). */
export const ENTERPRISE_TYPES: ReadonlySet<ImportEntityType> = new Set([
  "asset",
  "application",
  "data_store",
  "identity",
  // EAR P16: business_process persists to enterprise_entities like the other
  // enterprise types → its dedup keys + cap read enterprise_entities /
  // max_enterprise_entities (entityTypeToAssetType maps it to business_process).
  "business_process"
]);

/** Provenance stamped on enterprise_entities rows created by each import lane
 * (both values pre-exist in the 20260718 enterprise_entities_provenance_chk). */
export type ImportProvenance = "csv_import" | "connector";

/** Existing dedup keys (lowercased names) already in the org for this type. */
export async function existingKeys(entityType: ImportEntityType, orgId: string): Promise<Set<string>> {
  let sql: string;
  const params: unknown[] = [orgId];
  if (ENTERPRISE_TYPES.has(entityType)) {
    sql = `SELECT lower(name) AS k FROM enterprise_entities WHERE organization_id = $1 AND entity_type = $2`;
    params.push(entityType);
  } else if (entityType === "vendor") {
    sql = `SELECT lower(name) AS k FROM vendors WHERE organization_id = $1`;
  } else {
    sql = `SELECT lower(name) AS k FROM ai_systems WHERE organization_id = $1`;
  }
  const r = await pg.query<{ k: string }>(sql, params);
  return new Set(r.rows.map((row) => row.k));
}

/** Remaining capacity headroom (cap - used, floored at 0) for the relevant cap system. */
export async function capHeadroom(entityType: ImportEntityType, orgId: string): Promise<number> {
  const limit = ENTERPRISE_TYPES.has(entityType)
    ? await enforceEnterpriseEntityLimit(orgId)
    : await enforceEntityLimit(orgId); // vendor + ai_system share max_monitored_entities
  return Math.max(0, limit.cap - limit.used);
}

/**
 * external_refs (of the given set) that already exist in the org for this
 * import type — the connector re-sync dedup pre-pass. Vendors/ai_systems have
 * no external_ref column (and no connector emits them), so non-enterprise
 * types return the empty set.
 */
export async function existingExternalRefs(
  entityType: ImportEntityType,
  orgId: string,
  refs: readonly string[]
): Promise<Set<string>> {
  if (!ENTERPRISE_TYPES.has(entityType) || refs.length === 0) return new Set();
  const r = await pg.query<{ external_ref: string }>(
    `SELECT external_ref FROM enterprise_entities
      WHERE organization_id = $1 AND entity_type = $2 AND external_ref = ANY($3::text[])`,
    [orgId, entityType, [...refs]]
  );
  return new Set(r.rows.map((row) => row.external_ref));
}

/** Persist one normalized row. Returns true if a row was inserted (ON CONFLICT skips dups). */
export async function insertImportRow(
  orgId: string,
  normalized: NormalizedImportInput,
  provenance: ImportProvenance = "csv_import"
): Promise<boolean> {
  if (normalized.kind === "vendor") {
    const v = normalized.input;
    const r = await pg.query<{ id: string }>(
      `INSERT INTO vendors (organization_id, name, service_description, category, criticality,
                            data_sensitivity, access_level, website, owner_user_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'active')
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, v.name, v.service_description, v.category, v.criticality, v.data_sensitivity, v.access_level, v.website]
    );
    if ((r.rowCount ?? 0) === 0) return false;
    // EAR Phase 1: registry upsert, same tenant tx (flag-gated, dark by default).
    if (assetRegistryEnabled()) {
      await registerAsset(orgId, "vendor", "vendors", r.rows[0]!.id);
    }
    return true;
  }
  if (normalized.kind === "ai_system") {
    const a = normalized.input;
    const r = await pg.query<{ id: string }>(
      `INSERT INTO ai_systems (organization_id, name, use_case, owner_user_id, model_type,
                               data_classification, deployment_status, criticality, risk_classification)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, a.name, a.use_case, a.model_type, a.data_classification, a.deployment_status, a.criticality, a.risk_classification]
    );
    if ((r.rowCount ?? 0) === 0) return false;
    if (assetRegistryEnabled()) {
      await registerAsset(orgId, "ai_system", "ai_systems", r.rows[0]!.id);
    }
    return true;
  }
  // enterprise_entity (asset / application / data_store / identity)
  const e = normalized.input;
  const r = await pg.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name, description, owner_user_id,
                                      status, criticality, confidence, external_ref, provenance)
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, e.entity_type, e.name, e.description, e.status, e.criticality, e.confidence, e.external_ref, provenance]
  );
  if ((r.rowCount ?? 0) === 0) return false;
  const id = r.rows[0]!.id;
  if (assetRegistryEnabled()) {
    await registerAsset(orgId, entityTypeToAssetType(e.entity_type), "enterprise_entities", id);
  }
  if (e.entity_type === "data_store" && e.data_store) {
    const ds = e.data_store;
    await pg.query(
      `INSERT INTO enterprise_data_stores (enterprise_entity_id, organization_id,
                                           data_classification, residency_region, retention_policy, encryption_at_rest)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, orgId, ds.data_classification, ds.residency_region, ds.retention_policy, ds.encryption_at_rest]
    );
  }
  return true;
}
