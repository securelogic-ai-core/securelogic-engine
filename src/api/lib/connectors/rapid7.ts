/**
 * rapid7.ts — Rapid7 InsightVM asset connector (R7).
 *
 * API-token-keyed GET of the assets listing (ledger L-5.7; the platform
 * X-Api-Key header convention). Assets normalize to ECL `asset` entities;
 * criticality maps from InsightVM riskScore: ≥20000 critical, ≥10000 high,
 * ≥1000 medium, else low (thresholds documented, operator-tunable later).
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
  { key: "base_url", label: "InsightVM base URL", required: true, kind: "url" },
  { key: "api_token", label: "API token", required: true, kind: "secret" }
];

interface InsightVmAsset {
  id?: unknown;
  hostName?: unknown;
  ip?: unknown;
  os?: unknown;
  riskScore?: unknown;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function mapRiskScore(raw: unknown): NormalizedEntity["criticality"] | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  if (n >= 20_000) return "critical";
  if (n >= 10_000) return "high";
  if (n >= 1_000) return "medium";
  return "low";
}

export const rapid7Adapter: ConnectorAdapter = {
  id: "rapid7",
  displayName: "Rapid7 InsightVM",
  status: "implemented",
  category: "vulnerability",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, api_token } = config;
    if (!base_url || !api_token) {
      throw new Error("rapid7: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    return http.getJson(`${base}/api/3/assets?size=500`, {
      "X-Api-Key": api_token,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    const resources = (raw as { resources?: unknown } | null)?.resources;
    if (!Array.isArray(resources)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const a of resources as InsightVmAsset[]) {
      const id = str(a.id);
      const name = str(a.hostName) ?? str(a.ip);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: id };
      const os = str(a.os);
      if (os) entity.description = `InsightVM-scanned asset (${os})`;
      const crit = mapRiskScore(a.riskScore);
      if (crit) entity.criticality = crit;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
