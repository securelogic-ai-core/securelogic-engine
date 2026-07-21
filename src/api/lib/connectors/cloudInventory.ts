/**
 * cloudInventory.ts — Cloud inventory connector (AWS/Azure/GCP), R7.
 *
 * V1 INGESTION MODEL (documented, deliberate): native cloud-SDK enumeration
 * (SigV4 / IMDS / workload identity) is NOT reachable through the framework's
 * header-based HttpClient — that is a later increment. V1 consumes a
 * PROVIDER-NEUTRAL INVENTORY EXPORT the operator provisions (e.g. an AWS
 * Config / Azure Resource Graph / GCP Asset Inventory export published to a
 * pre-authorized HTTPS URL — ledger L-5.8): `{ resources: [{ id, name, type,
 * region }] }`. `fetch()` therefore requires the optional `inventory_export_url`
 * config field and throws a typed error without it; `normalize()` is complete
 * regardless of how the export is obtained.
 *
 * Type mapping: bucket/storage/database → `data_store` (region → residency);
 * function/app/service/web → `application`; everything else → `asset`.
 * DARK; no callers.
 */

import {
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";
import type { ImportEntityType } from "../enterpriseContextImport.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "provider", label: "Cloud provider", required: true, kind: "string" },
  { key: "account_id", label: "Account / subscription / project ID", required: true, kind: "string" },
  { key: "role_arn_or_credential", label: "Assumed role ARN or credential ref", required: true, kind: "secret" },
  // V1 ingestion surface (see header). Optional: config validates without it,
  // but fetch() requires it until SDK-native enumeration lands.
  { key: "inventory_export_url", label: "Inventory export URL (pre-authorized HTTPS)", required: false, kind: "url" }
];

interface CloudResource {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  region?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function typeToEntityType(raw: string): ImportEntityType {
  const t = raw.toLowerCase();
  if (t.includes("bucket") || t.includes("storage") || t.includes("database") || t.includes("rds") || t.includes("sql") || t.includes("s3")) {
    return "data_store";
  }
  if (t.includes("function") || t.includes("app") || t.includes("service") || t.includes("web") || t.includes("lambda")) {
    return "application";
  }
  return "asset";
}

export const cloudInventoryAdapter: ConnectorAdapter = {
  id: "cloud_inventory",
  displayName: "Cloud Inventory (AWS/Azure/GCP)",
  status: "implemented",
  category: "cloud",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { provider, account_id, inventory_export_url } = config;
    if (!provider || !account_id) {
      throw new Error("cloud_inventory: incomplete config (validateConfig must pass first)");
    }
    if (!inventory_export_url) {
      throw new Error(
        "cloud_inventory_requires_export_url: v1 ingests a pre-authorized inventory export; SDK-native enumeration is a later increment (see adapter header + ledger L-5.8)"
      );
    }
    return http.getJson(inventory_export_url, { Accept: "application/json" });
  },

  normalize(raw): NormalizedInventory {
    const resources = (raw as { resources?: unknown } | null)?.resources;
    if (!Array.isArray(resources)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const r of resources as CloudResource[]) {
      const id = str(r.id);
      const name = str(r.name);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const rawType = str(r.type) ?? "";
      const entity_type = typeToEntityType(rawType);
      const entity: NormalizedEntity = { entity_type, name, external_ref: id };
      if (rawType) entity.description = `Cloud resource (${rawType})`;
      const region = str(r.region);
      if (entity_type === "data_store" && region) entity.data_store = { residency_region: region };
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
