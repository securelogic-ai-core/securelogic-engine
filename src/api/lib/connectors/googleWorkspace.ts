/**
 * googleWorkspace.ts — Google Workspace directory connector (ERIP E2.P6).
 *
 * Auth = service-account JWT with domain-wide delegation (gcpServiceAccountJwt
 * with an admin `subject`), then the Admin SDK Directory users list. Active
 * users normalize to ECL `identity` entities (suspended users skipped). Category
 * 'identity' → import lane (accounts). `fetch()` is the only I/O; `normalize()`
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
import { mintServiceAccountAssertion } from "./gcpServiceAccountJwt.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "client_email", label: "Service-account email", required: true, kind: "string" },
  { key: "private_key", label: "Service-account private key (PEM)", required: true, kind: "secret" },
  { key: "admin_email", label: "Workspace admin to impersonate", required: true, kind: "string" },
  { key: "customer_id", label: "Workspace customer ID (or 'my_customer')", required: true, kind: "string" }
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";
const DIRECTORY = "https://admin.googleapis.com/admin/directory/v1";

interface GwsUser {
  id?: unknown;
  primaryEmail?: unknown;
  name?: { fullName?: unknown } | null;
  suspended?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const googleWorkspaceAdapter: ConnectorAdapter = {
  id: "google_workspace",
  displayName: "Google Workspace",
  status: "implemented",
  category: "identity",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { client_email, private_key, admin_email, customer_id } = config;
    if (!client_email || !private_key || !admin_email || !customer_id) {
      throw new Error("google_workspace: incomplete config (validateConfig must pass first)");
    }
    const postForm = requirePostForm(http, "google_workspace");
    const assertion = mintServiceAccountAssertion({
      clientEmail: client_email,
      privateKeyPem: private_key.includes("\\n") ? private_key.replace(/\\n/g, "\n") : private_key,
      scope: SCOPE,
      subject: admin_email,
      iat: Math.floor(new Date().getTime() / 1000)
    });
    const token = (await postForm(TOKEN_URL, { Accept: "application/json" }, {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("google_workspace: token endpoint returned no access_token");

    return http.getJson(
      `${DIRECTORY}/users?customer=${encodeURIComponent(customer_id)}&maxResults=200`,
      { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    );
  },

  normalize(raw): NormalizedInventory {
    const users = (raw as { users?: unknown } | null)?.users;
    if (!Array.isArray(users)) return { entities: [], relationships: [] };
    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const u of users as GwsUser[]) {
      const id = str(u.id);
      if (!id || seen.has(id) || u.suspended === true) continue;
      const email = str(u.primaryEmail);
      const name = str(u.name?.fullName) ?? email;
      if (!name) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "identity", name, external_ref: id };
      if (email && email !== name) entity.description = `Workspace account (${email})`;
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
