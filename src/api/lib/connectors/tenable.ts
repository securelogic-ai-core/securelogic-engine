/**
 * tenable.ts — Tenable.io asset connector (R7).
 *
 * Header-keyed (X-ApiKeys) GET of the assets listing (ledger L-5.5). Assets
 * normalize to ECL `asset` entities; criticality maps from Tenable's ACR
 * (Asset Criticality Rating, 1–10): ≥9 critical, ≥7 high, ≥4 medium, else low.
 * DARK; no callers.
 */

import {
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "base_url", label: "Tenable.io base URL", required: true, kind: "url" },
  { key: "access_key", label: "Access key", required: true, kind: "secret" },
  { key: "secret_key", label: "Secret key", required: true, kind: "secret" }
];

interface TenableAsset {
  id?: unknown;
  hostname?: unknown;
  fqdn?: unknown;
  acr_score?: unknown;
  operating_system?: unknown;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  // Tenable list fields (hostname/fqdn/operating_system) arrive as string arrays.
  if (Array.isArray(v)) return str(v[0]);
  return undefined;
}

function mapAcr(raw: unknown): NormalizedEntity["criticality"] | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  if (n >= 9) return "critical";
  if (n >= 7) return "high";
  if (n >= 4) return "medium";
  return "low";
}

export const tenableAdapter: ConnectorAdapter = {
  id: "tenable",
  displayName: "Tenable",
  status: "implemented",
  category: "vulnerability",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, access_key, secret_key } = config;
    if (!base_url || !access_key || !secret_key) {
      throw new Error("tenable: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    return http.getJson(`${base}/assets`, {
      "X-ApiKeys": `accessKey=${access_key};secretKey=${secret_key}`,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    const assets = (raw as { assets?: unknown } | null)?.assets;
    if (!Array.isArray(assets)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const a of assets as TenableAsset[]) {
      const id = str(a.id);
      const name = str(a.hostname) ?? str(a.fqdn);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: id };
      const os = str(a.operating_system);
      if (os) entity.description = `Tenable-scanned asset (${os})`;
      const crit = mapAcr(a.acr_score);
      if (crit) entity.criticality = crit;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
