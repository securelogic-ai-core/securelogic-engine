/**
 * qualys.ts — Qualys host-asset connector (R7).
 *
 * Basic-auth GET of the Asset Management host-asset search (JSON envelope,
 * ledger L-5.6). Host assets normalize to ECL `asset` entities; criticality
 * maps from Qualys criticalityScore (1–5): 5 critical, 4 high, 3 medium,
 * else low. DARK; no callers.
 */

import {
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "base_url", label: "Qualys API base URL", required: true, kind: "url" },
  { key: "username", label: "Username", required: true, kind: "string" },
  { key: "password", label: "Password", required: true, kind: "secret" }
];

interface QualysHostAsset {
  HostAsset?: {
    id?: unknown;
    name?: unknown;
    os?: unknown;
    criticalityScore?: unknown;
  };
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function mapCriticalityScore(raw: unknown): NormalizedEntity["criticality"] | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  if (n >= 5) return "critical";
  if (n >= 4) return "high";
  if (n >= 3) return "medium";
  return "low";
}

export const qualysAdapter: ConnectorAdapter = {
  id: "qualys",
  displayName: "Qualys",
  status: "implemented",
  category: "vulnerability",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, username, password } = config;
    if (!base_url || !username || !password) {
      throw new Error("qualys: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    return http.getJson(`${base}/qps/rest/2.0/search/am/hostasset`, {
      Authorization: `Basic ${auth}`,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    const data = (raw as { ServiceResponse?: { data?: unknown } } | null)?.ServiceResponse?.data;
    if (!Array.isArray(data)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const row of data as QualysHostAsset[]) {
      const host = row?.HostAsset;
      if (!host || typeof host !== "object") continue;
      const id = str(host.id);
      const name = str(host.name);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: id };
      const os = str(host.os);
      if (os) entity.description = `Qualys host asset (${os})`;
      const crit = mapCriticalityScore(host.criticalityScore);
      if (crit) entity.criticality = crit;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
