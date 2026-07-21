/**
 * jamf.ts — Jamf Pro managed-device connector (ERIP E2.P6).
 *
 * Auth = Jamf Pro API OAuth client-credentials (POST /api/oauth/token), then
 * the computer inventory. Each computer normalizes to an ECL `asset` (endpoint
 * category → endpoint detail). `fetch()` is the only I/O; `normalize()` is pure.
 * DARK; real-credential round-trips are operator-owned (ledger).
 */

import {
  requirePostForm,
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "base_url", label: "Jamf Pro base URL", required: true, kind: "url" },
  { key: "client_id", label: "API client ID", required: true, kind: "string" },
  { key: "client_secret", label: "API client secret", required: true, kind: "secret" }
];

interface JamfComputer {
  id?: unknown;
  general?: { name?: unknown } | null;
  operatingSystem?: { version?: unknown } | null;
}

function str(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const jamfAdapter: ConnectorAdapter = {
  id: "jamf",
  displayName: "Jamf Pro",
  status: "implemented",
  category: "endpoint",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, client_id, client_secret } = config;
    if (!base_url || !client_id || !client_secret) {
      throw new Error("jamf: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    const postForm = requirePostForm(http, "jamf");
    const token = (await postForm(`${base}/api/oauth/token`, { Accept: "application/json" }, {
      grant_type: "client_credentials",
      client_id,
      client_secret
    })) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("jamf: token endpoint returned no access_token");

    return http.getJson(`${base}/api/v1/computers-inventory?page-size=200&section=GENERAL&section=OPERATING_SYSTEM`, {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    const results = (raw as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) return { entities: [], relationships: [] };
    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const c of results as JamfComputer[]) {
      const id = str(c.id);
      const name = str(c.general?.name);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: `jamf:${id}` };
      const ver = str(c.operatingSystem?.version);
      if (ver) entity.metadata = { os: `macOS ${ver}` };
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
