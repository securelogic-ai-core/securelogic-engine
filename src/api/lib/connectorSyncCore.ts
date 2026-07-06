/**
 * connectorSyncCore.ts — EAR Phase 3b: the PURE connector→registry mapping
 * plane (ARCHITECTURE.md §3.4 "entity_type outputs map 1:1 to asset types").
 *
 * Given an adapter's category and its normalized inventory, decide — per
 * entity — whether it becomes a Tier-1 DETAIL asset (created via
 * createDetailAsset, Phase 3a) or flows through the existing ECL IMPORT path
 * (planImport → the manual-create validators, the CSV-parity lane):
 *
 *   endpoint / vulnerability  'asset' rows are managed devices → `endpoint`
 *                             detail assets (hostname = name).
 *   cloud                     'asset' rows are cloud resources → `cloud_resource`
 *                             detail assets (provider from the connector config);
 *                             'application' / 'data_store' rows keep their
 *                             richer ECL homes via the import path.
 *   cmdb                      everything via the import path — full CSV-import
 *                             parity (a CMDB row IS an ECL entity).
 *   identity                  'identity' rows are ACCOUNTS → import path
 *                             (enterprise_entities); the IdP SYSTEM itself is
 *                             additionally represented once per sync as an
 *                             `identity_system` detail asset (§2.3: accounts
 *                             are generic entities, the system is the asset).
 *
 * Relationship persistence is DEFERRED (CSV-import parity — the import path
 * has no relationship lane either); counts are surfaced, never silently
 * dropped. NO I/O here — fully unit-testable.
 */

import type { ConnectorAdapter, NormalizedEntity, NormalizedInventory } from "./connectors/types.js";
import type { AssetDetailCreateInput } from "./assetDetailValidation.js";
import type { ImportEntityType, ImportRow } from "./enterpriseContextImport.js";

export const CONNECTOR_SYNC_JOB_TYPE = "connector_sync";

/** Hard per-sync entity cap — a runaway export is truncated loudly, not ingested unbounded. */
export const MAX_ENTITIES_PER_SYNC = 5000;

const CLOUD_PROVIDERS = new Set(["aws", "azure", "gcp"]);

export interface ConnectorSyncPlan {
  /** Tier-1 detail assets to create via createDetailAsset (Phase 3a shared path). */
  detailInputs: AssetDetailCreateInput[];
  /** Entities for the ECL import path, grouped by import entity type. */
  importGroups: Partial<Record<ImportEntityType, ImportRow[]>>;
  /** Normalized relationships seen but not persisted (deferred — CSV parity). */
  relationshipsSkipped: number;
  /** Entities dropped past MAX_ENTITIES_PER_SYNC. */
  truncated: number;
}

/** NormalizedEntity → the flat ImportRow shape adaptRow() expects. */
function toImportRow(e: NormalizedEntity): ImportRow {
  const row: ImportRow = {
    name: e.name,
    description: e.description ?? null,
    criticality: e.criticality ?? null,
    external_ref: e.external_ref
  };
  if (e.data_store) {
    row.data_classification = e.data_store.data_classification ?? null;
    row.residency_region = e.data_store.residency_region ?? null;
  }
  return row;
}

function endpointDetail(e: NormalizedEntity): AssetDetailCreateInput {
  return {
    asset_type: "endpoint",
    name: e.name,
    criticality: e.criticality ?? null,
    status: "active",
    external_ref: e.external_ref,
    typed: { hostname: e.name }
  };
}

function cloudResourceDetail(e: NormalizedEntity, provider: string): AssetDetailCreateInput {
  return {
    asset_type: "cloud_resource",
    name: e.name,
    criticality: e.criticality ?? null,
    status: "active",
    external_ref: e.external_ref,
    typed: { provider }
  };
}

/**
 * The one identity_system detail asset representing the configured IdP itself
 * (identity category). Keyed by the config's base_url host so re-syncs dedup
 * on external_ref; null when the config carries no parseable https base_url.
 */
export function idpSystemDetail(
  adapter: Pick<ConnectorAdapter, "id" | "displayName">,
  config: Record<string, string>
): AssetDetailCreateInput | null {
  const baseUrl = config.base_url;
  if (!baseUrl) return null;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  return {
    asset_type: "identity_system",
    name: host,
    criticality: null,
    status: "active",
    external_ref: `${adapter.id}:${host}`,
    typed: { idp_vendor: adapter.displayName, protocol: null }
  };
}

/**
 * Map one normalized inventory to its persistence plan. Deterministic; the
 * caller (worker) owns all I/O: external-ref dedup, planImport over the
 * import groups, createDetailAsset over the detail inputs.
 */
export function planConnectorSync(
  adapter: Pick<ConnectorAdapter, "id" | "displayName" | "category">,
  inventory: NormalizedInventory,
  config: Record<string, string>
): ConnectorSyncPlan {
  const plan: ConnectorSyncPlan = {
    detailInputs: [],
    importGroups: {},
    relationshipsSkipped: inventory.relationships.length,
    truncated: 0
  };

  let entities = inventory.entities;
  if (entities.length > MAX_ENTITIES_PER_SYNC) {
    plan.truncated = entities.length - MAX_ENTITIES_PER_SYNC;
    entities = entities.slice(0, MAX_ENTITIES_PER_SYNC);
  }

  const rawProvider = (config.provider ?? "").trim().toLowerCase();
  const provider = CLOUD_PROVIDERS.has(rawProvider) ? rawProvider : "other";

  for (const e of entities) {
    if (e.entity_type === "asset" && (adapter.category === "endpoint" || adapter.category === "vulnerability")) {
      plan.detailInputs.push(endpointDetail(e));
      continue;
    }
    if (e.entity_type === "asset" && adapter.category === "cloud") {
      plan.detailInputs.push(cloudResourceDetail(e, provider));
      continue;
    }
    (plan.importGroups[e.entity_type] ??= []).push(toImportRow(e));
  }

  if (adapter.category === "identity") {
    const idp = idpSystemDetail(adapter, config);
    if (idp) plan.detailInputs.push(idp);
  }

  return plan;
}
