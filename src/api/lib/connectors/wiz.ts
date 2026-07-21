/**
 * wiz.ts — Wiz cloud-security graph connector (R7).
 *
 * OAuth2 client-credentials (ledger L-5.4), then one GraphQL cloudResources
 * page. Resources normalize by type: bucket/database/storage → `data_store`
 * (with the cloud region as residency), app/service/function → `application`,
 * everything else → `asset`. DARK; no callers. The operator's L-5.4 round-trip
 * validates the tenant-specific auth + GraphQL endpoints.
 */

import {
  requirePostForm,
  requirePostJson,
  validateAgainstFields,
  type ConnectorAdapter,
  type ConnectorConfigField,
  type NormalizedEntity,
  type NormalizedInventory
} from "./types.js";
import type { ImportEntityType } from "../enterpriseContextImport.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "base_url", label: "Wiz API endpoint", required: true, kind: "url" },
  { key: "client_id", label: "Wiz client ID", required: true, kind: "string" },
  { key: "client_secret", label: "Wiz client secret", required: true, kind: "secret" }
];

const RESOURCE_QUERY = `
  query CloudResources($first: Int!) {
    cloudResources(first: $first) {
      nodes { id name type region }
    }
  }`;

interface WizNode {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  region?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Wiz resource type → ECL import entity type. */
function typeToEntityType(raw: string): ImportEntityType {
  const t = raw.toLowerCase();
  if (t.includes("bucket") || t.includes("database") || t.includes("storage") || t.includes("db")) return "data_store";
  if (t.includes("application") || t.includes("service") || t.includes("function") || t.includes("web")) return "application";
  return "asset";
}

export const wizAdapter: ConnectorAdapter = {
  id: "wiz",
  displayName: "Wiz",
  status: "implemented",
  category: "cloud",
  configFields: CONFIG_FIELDS,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http) {
    const { base_url, client_id, client_secret } = config;
    if (!base_url || !client_id || !client_secret) {
      throw new Error("wiz: incomplete config (validateConfig must pass first)");
    }
    const base = base_url.replace(/\/+$/, "");
    const postForm = requirePostForm(http, "wiz");
    const postJson = requirePostJson(http, "wiz");

    const token = (await postForm(
      `${base}/oauth/token`,
      { Accept: "application/json" },
      { grant_type: "client_credentials", client_id, client_secret, audience: "wiz-api" }
    )) as { access_token?: unknown };
    const accessToken = str(token?.access_token);
    if (!accessToken) throw new Error("wiz: token endpoint returned no access_token");

    return postJson(
      `${base}/graphql`,
      { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      { query: RESOURCE_QUERY, variables: { first: 1000 } }
    );
  },

  normalize(raw): NormalizedInventory {
    const nodes = (raw as { data?: { cloudResources?: { nodes?: unknown } } } | null)?.data?.cloudResources?.nodes;
    if (!Array.isArray(nodes)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const seen = new Set<string>();
    for (const n of nodes as WizNode[]) {
      const id = str(n.id);
      const name = str(n.name);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const rawType = str(n.type) ?? "";
      const entity_type = typeToEntityType(rawType);
      const entity: NormalizedEntity = { entity_type, name, external_ref: id };
      if (rawType) entity.description = `Wiz cloud resource (${rawType})`;
      const region = str(n.region);
      if (entity_type === "data_store" && region) entity.data_store = { residency_region: region };
      entities.push(entity);
    }
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    return { entities, relationships: [] };
  }
};
