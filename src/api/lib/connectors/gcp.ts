/**
 * gcp.ts — native Google Cloud connector (ERIP E2.P5).
 *
 * Auth = service-account JWT bearer (gcpServiceAccountJwt.ts): mint a signed
 * assertion, exchange it for an access token, then call Cloud Asset Inventory
 * for the project. Each asset normalizes to a `cloud_resource` (the
 * connectorSyncCore cloud lane stamps provider='gcp'). `fetch()` is the only
 * I/O; `normalize()` is pure. DARK; real-credential round-trips are
 * operator-owned (connector ledger).
 */

import {
  requirePostForm,
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";
import { mintServiceAccountAssertion } from "./gcpServiceAccountJwt.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "client_email", label: "Service-account email", required: true, kind: "string" },
  { key: "private_key", label: "Service-account private key (PEM)", required: true, kind: "secret" },
  { key: "project_id", label: "GCP project ID", required: true, kind: "string" }
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform.read-only";
const ASSET_API = "https://cloudasset.googleapis.com/v1";

interface GcpAsset {
  name?: unknown;
  assetType?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Short name from a full GCP asset resource path (last '/' segment). */
function shortName(full: string): string {
  const seg = full.split("/").pop() ?? full;
  return seg.length > 0 ? seg : full;
}

export const gcpAdapter: ConnectorAdapter = {
  id: "gcp",
  displayName: "Google Cloud Platform",
  status: "implemented",
  category: "cloud",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { client_email, private_key, project_id } = config;
    if (!client_email || !private_key || !project_id) {
      throw new Error("gcp: incomplete config (validateConfig must pass first)");
    }
    const postForm = requirePostForm(http, "gcp");
    const assertion = mintServiceAccountAssertion({
      clientEmail: client_email,
      privateKeyPem: private_key.includes("\\n") ? private_key.replace(/\\n/g, "\n") : private_key,
      scope: SCOPE,
      iat: Math.floor(new Date().getTime() / 1000)
    });
    const token = (await postForm(TOKEN_URL, { Accept: "application/json" }, {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("gcp: token endpoint returned no access_token");

    return http.getJson(
      `${ASSET_API}/projects/${encodeURIComponent(project_id)}/assets?contentType=RESOURCE&pageSize=100`,
      { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    );
  },

  normalize(raw): NormalizedInventory {
    const assets = (raw as { assets?: unknown } | null)?.assets;
    if (!Array.isArray(assets)) return { entities: [], relationships: [] };
    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const a of assets as GcpAsset[]) {
      const full = str(a.name);
      if (!full || seen.has(full)) continue;
      seen.add(full);
      const entity: NormalizedEntity = { entity_type: "asset", name: shortName(full), external_ref: full };
      const type = str(a.assetType);
      if (type) entity.metadata = { resource_type: type };
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
