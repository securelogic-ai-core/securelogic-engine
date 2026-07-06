/**
 * microsoftGraph.ts — Microsoft Graph device connector (ERIP E2.P6).
 *
 * Auth = OAuth2 client-credentials (the Azure/Defender pattern) against Graph,
 * then the directory devices list. Each device normalizes to an ECL `asset`
 * (endpoint category → endpoint detail). `fetch()` is the only I/O; `normalize()`
 * is pure. DARK; real-credential round-trips are operator-owned (ledger).
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
  { key: "tenant_id", label: "Azure tenant ID", required: true, kind: "string" },
  { key: "client_id", label: "App registration client ID", required: true, kind: "string" },
  { key: "client_secret", label: "Client secret", required: true, kind: "secret" }
];

const GRAPH = "https://graph.microsoft.com";

interface GraphDevice {
  id?: unknown;
  displayName?: unknown;
  operatingSystem?: unknown;
  operatingSystemVersion?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const microsoftGraphAdapter: ConnectorAdapter = {
  id: "microsoft_graph",
  displayName: "Microsoft Graph",
  status: "implemented",
  category: "endpoint",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { tenant_id, client_id, client_secret } = config;
    if (!tenant_id || !client_id || !client_secret) {
      throw new Error("microsoft_graph: incomplete config (validateConfig must pass first)");
    }
    const postForm = requirePostForm(http, "microsoft_graph");
    const token = (await postForm(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant_id)}/oauth2/v2.0/token`,
      { Accept: "application/json" },
      { grant_type: "client_credentials", client_id, client_secret, scope: `${GRAPH}/.default` }
    )) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("microsoft_graph: token endpoint returned no access_token");

    return http.getJson(`${GRAPH}/v1.0/devices?$top=200`, {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    const value = (raw as { value?: unknown } | null)?.value;
    if (!Array.isArray(value)) return { entities: [], relationships: [] };
    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const d of value as GraphDevice[]) {
      const id = str(d.id);
      const name = str(d.displayName);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: id };
      const os = str(d.operatingSystem);
      const ver = str(d.operatingSystemVersion);
      if (os) entity.metadata = { os: ver ? `${os} ${ver}` : os };
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
