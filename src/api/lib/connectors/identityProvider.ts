/**
 * identityProvider.ts — Identity provider connector (Okta-first; Entra later), R7.
 *
 * Token-keyed GET of the users listing using Okta's `SSWS` scheme (ledger
 * L-5.9; Entra ID needs an OAuth flow and lands as a follow-on — documented,
 * not silently absent). Active users normalize to ECL `identity` entities
 * (DEPROVISIONED/SUSPENDED users are skipped — inventory covers live access
 * only). Requires the Slice-3 import path's `identity` support (added in this
 * same R7 change). DARK; no callers.
 */

import {
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "base_url", label: "IdP base URL", required: true, kind: "url" },
  { key: "api_token", label: "API token", required: true, kind: "secret" }
];

const SKIP_STATUSES = new Set(["DEPROVISIONED", "SUSPENDED"]);

interface OktaUser {
  id?: unknown;
  status?: unknown;
  profile?: { displayName?: unknown; login?: unknown; email?: unknown } | null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const identityProviderAdapter: ConnectorAdapter = {
  id: "identity_provider",
  displayName: "Identity Provider (Okta/Entra)",
  status: "implemented",
  category: "identity",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, api_token } = config;
    if (!base_url || !api_token) {
      throw new Error("identity_provider: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    return http.getJson(`${base}/api/v1/users?limit=200`, {
      Authorization: `SSWS ${api_token}`,
      Accept: "application/json"
    });
  },

  normalize(raw): NormalizedInventory {
    if (!Array.isArray(raw)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const u of raw as OktaUser[]) {
      const id = str(u.id);
      if (!id || seen.has(id)) continue;
      const status = str(u.status)?.toUpperCase();
      if (status && SKIP_STATUSES.has(status)) continue;
      const profile = u.profile ?? {};
      const name = str(profile.displayName) ?? str(profile.login) ?? str(profile.email);
      if (!name) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "identity", name, external_ref: id };
      const login = str(profile.login);
      if (login && login !== name) entity.description = `IdP account (${login})`;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
