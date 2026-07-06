/**
 * github.ts — GitHub organization repository connector (ERIP E2.P6).
 *
 * Auth = a personal-access / fine-grained token (Bearer). Lists the org's
 * repositories; each repo normalizes to an ECL `application` (cmdb category →
 * import lane, full CSV parity). `fetch()` is the only I/O; `normalize()` is
 * pure. DARK; real-credential round-trips are operator-owned (ledger).
 */

import {
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "base_url", label: "GitHub API base URL", required: true, kind: "url" },
  { key: "org", label: "GitHub organization login", required: true, kind: "string" },
  { key: "token", label: "Access token", required: true, kind: "secret" }
];

interface GhRepo {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  description?: unknown;
  archived?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export const githubAdapter: ConnectorAdapter = {
  id: "github",
  displayName: "GitHub",
  status: "implemented",
  category: "cmdb",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, org, token } = config;
    if (!base_url || !org || !token) {
      throw new Error("github: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    return http.getJson(`${base}/orgs/${encodeURIComponent(org)}/repos?per_page=100&type=all`, {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    });
  },

  normalize(raw): NormalizedInventory {
    if (!Array.isArray(raw)) return { entities: [], relationships: [] };
    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const r of raw as GhRepo[]) {
      const id = str(r.id) ?? (typeof r.id === "number" ? String(r.id) : undefined);
      const name = str(r.full_name) ?? str(r.name);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const entity: NormalizedEntity = { entity_type: "application", name, external_ref: `github:${id}` };
      const desc = str(r.description);
      if (desc) entity.description = desc;
      if (r.archived === true) entity.metadata = { archived: "true" };
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
