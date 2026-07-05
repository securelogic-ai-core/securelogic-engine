/**
 * crowdstrikeFalcon.ts — CrowdStrike Falcon connector (R7).
 *
 * OAuth2 client-credentials against the operator's Falcon API client (ledger
 * L-5.3), then the combined device listing. Devices normalize to ECL `asset`
 * entities. The exact device-listing resource path is confirmed at the L-5.3
 * real-credential round-trip (operator validation) — the shape consumed here
 * is Falcon's standard `{ resources: [...] }` envelope. DARK; no callers.
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
  { key: "base_url", label: "Falcon API base URL", required: true, kind: "url" },
  { key: "client_id", label: "Falcon client ID", required: true, kind: "string" },
  { key: "client_secret", label: "Falcon client secret", required: true, kind: "secret" }
];

interface FalconDevice {
  device_id?: unknown;
  hostname?: unknown;
  platform_name?: unknown;
  os_version?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const crowdstrikeFalconAdapter: ConnectorAdapter = {
  id: "crowdstrike_falcon",
  displayName: "CrowdStrike Falcon",
  status: "implemented",
  category: "endpoint",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, client_id, client_secret } = config;
    if (!base_url || !client_id || !client_secret) {
      throw new Error("crowdstrike_falcon: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    const postForm = requirePostForm(http, "crowdstrike_falcon");
    const token = (await postForm(
      `${base}/oauth2/token`,
      { Accept: "application/json" },
      { client_id, client_secret }
    )) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("crowdstrike_falcon: token endpoint returned no access_token");

    return http.getJson(`${base}/devices/combined/devices/v1?limit=1000`, {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    const resources = (raw as { resources?: unknown } | null)?.resources;
    if (!Array.isArray(resources)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const d of resources as FalconDevice[]) {
      const id = str(d.device_id);
      const name = str(d.hostname);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: id };
      const platform = str(d.platform_name);
      const osv = str(d.os_version);
      if (platform || osv) entity.description = `Falcon-managed host (${[platform, osv].filter(Boolean).join(" ")})`;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
