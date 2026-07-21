/**
 * azure.ts — native Azure cloud connector (ERIP E2.P5).
 *
 * Auth = OAuth2 client-credentials against the operator's Azure AD app
 * (the Defender pattern), then the Azure Resource Manager resources list for
 * the subscription. Each resource normalizes to a `cloud_resource` asset (the
 * connectorSyncCore cloud lane stamps provider='azure'; region from location).
 * `fetch()` is the only I/O; `normalize()` is pure. DARK; real-credential
 * round-trips are operator-owned (connector ledger).
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
  { key: "client_secret", label: "Client secret", required: true, kind: "secret" },
  { key: "subscription_id", label: "Azure subscription ID", required: true, kind: "string" }
];

const MGMT = "https://management.azure.com";

interface AzureResource {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  location?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const azureAdapter: ConnectorAdapter = {
  id: "azure",
  displayName: "Microsoft Azure",
  status: "implemented",
  category: "cloud",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { tenant_id, client_id, client_secret, subscription_id } = config;
    if (!tenant_id || !client_id || !client_secret || !subscription_id) {
      throw new Error("azure: incomplete config (validateConfig must pass first)");
    }
    const postForm = requirePostForm(http, "azure");
    const token = (await postForm(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant_id)}/oauth2/v2.0/token`,
      { Accept: "application/json" },
      { grant_type: "client_credentials", client_id, client_secret, scope: `${MGMT}/.default` }
    )) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("azure: token endpoint returned no access_token");

    return http.getJson(
      `${MGMT}/subscriptions/${encodeURIComponent(subscription_id)}/resources?api-version=2021-04-01`,
      { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    );
  },

  normalize(raw): NormalizedInventory {
    const value = (raw as { value?: unknown } | null)?.value;
    if (!Array.isArray(value)) return { entities: [], relationships: [] };
    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const r of value as AzureResource[]) {
      const id = str(r.id);
      const name = str(r.name);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "asset", name, external_ref: id };
      const meta: Record<string, string> = {};
      const type = str(r.type);
      if (type) meta.resource_type = type;
      const location = str(r.location);
      if (location) meta.region = location;
      if (Object.keys(meta).length > 0) entity.metadata = meta;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
