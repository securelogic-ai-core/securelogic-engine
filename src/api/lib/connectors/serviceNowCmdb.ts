/**
 * serviceNowCmdb.ts — the REFERENCE connector adapter (Slice 8): ServiceNow CMDB.
 *
 * The canonical inventory source, so it is the fully-implemented reference the other
 * (planned) connectors mirror. `fetch()` reads the CMDB CI table via the injected
 * HttpClient (Basic auth from operator credentials); `normalize()` is pure and maps
 * CMDB CIs → ECL entities + dependency relationships. Ships DARK — nothing calls it.
 */

import {
  type ConnectorAdapter,
  type ConnectorConfigField,
  type ConnectorWriteback,
  type HttpClient,
  type NormalizedInventory,
  type NormalizedEntity,
  type NormalizedRelationship,
  requirePatchJson,
  validateAgainstFields
} from "./types.js";
import type { ImportEntityType } from "../enterpriseContextImport.js";

const CONFIG_FIELDS: ConnectorConfigField[] = [
  { key: "instance_url", label: "ServiceNow instance URL", required: true, kind: "url" },
  { key: "username", label: "Integration username", required: true, kind: "string" },
  { key: "password", label: "Integration password", required: true, kind: "secret" }
];

const DEFAULT_LIMIT = 1000;

/** A single CMDB CI record (the fields we consume from the ServiceNow table API). */
interface CmdbCi {
  sys_id?: unknown;
  name?: unknown;
  sys_class_name?: unknown;
  short_description?: unknown;
  business_criticality?: unknown;
  depends_on?: unknown;
  sys_updated_on?: unknown;
  // E2.P4 discovery hints:
  assigned_to?: unknown;
  owned_by?: unknown;
  os?: unknown;
  ip_address?: unknown;
}

/**
 * Read the CMDB CI table, optionally filtered to rows updated after `since`
 * (the incremental watermark). Shared by fetch() (full) and fetchDelta().
 */
function fetchCis(config: Record<string, string>, http: HttpClient, since: string | null): Promise<unknown> {
  const instance = config.instance_url;
  const username = config.username;
  const password = config.password;
  if (!instance || !username || !password) {
    throw new Error("servicenow_cmdb: incomplete config (validateConfig must pass first)");
  }
  const base = instance.replace(/\/+$/, "");
  const params = new URLSearchParams({ sysparm_limit: String(DEFAULT_LIMIT) });
  if (since) params.set("sysparm_query", `sys_updated_on>${since}`);
  const url = `${base}/api/now/table/cmdb_ci?${params.toString()}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  return http.getJson(url, { Authorization: `Basic ${auth}`, Accept: "application/json" });
}

/** Map a ServiceNow sys_class_name to an ECL import entity type. */
function classToEntityType(sysClass: string): ImportEntityType {
  // Strip the ServiceNow "cmdb_ci_"/"cmdb_" prefix FIRST — otherwise the "db" in
  // "cmdb_..." spuriously matches the data_store rule for every class.
  const c = sysClass.toLowerCase().replace(/^cmdb_ci_/, "").replace(/^cmdb_/, "");
  if (c.includes("business_app") || c.includes("appl") || c.includes("service")) return "application";
  if (c.includes("db") || c.includes("database") || c.includes("storage")) return "data_store";
  // servers, hardware, network gear, and anything unrecognized → asset.
  return "asset";
}

/** Map ServiceNow business_criticality to the ECL vocabulary. */
function mapCriticality(raw: unknown): NormalizedEntity["criticality"] | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.toLowerCase();
  if (v.includes("most critical") || v.startsWith("1")) return "critical";
  if (v.includes("high") || v.startsWith("2")) return "high";
  if (v.includes("medium") || v.startsWith("3")) return "medium";
  if (v.includes("low") || v.startsWith("4")) return "low";
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * ERIP-AD-12 (E2a): the CMDB CI columns SecureLogic is allowed to write back.
 * This whitelist is the ONLY admission gate for outbound mutation — an intent
 * for any other field is rejected before it is enqueued. Deliberately narrow:
 * the fields an enterprise would let an external risk platform assert on a CI.
 */
const WRITEBACK_FIELDS = ["business_criticality", "owned_by", "short_description", "comments"] as const;

function snBase(config: Record<string, string>): { base: string; auth: string } {
  const instance = config.instance_url;
  const username = config.username;
  const password = config.password;
  if (!instance || !username || !password) {
    throw new Error("servicenow_cmdb: incomplete config (validateConfig must pass first)");
  }
  return {
    base: instance.replace(/\/+$/, ""),
    auth: Buffer.from(`${username}:${password}`).toString("base64")
  };
}

const serviceNowWriteback: ConnectorWriteback = {
  fields: WRITEBACK_FIELDS,

  /**
   * Batch-read the current external values of the writeback fields for the
   * given sys_ids. Reference fields are returned as raw sys_id strings
   * (exclude_reference_link) so comparisons are exact-string; absent fields map
   * to null. Records not returned by ServiceNow are simply absent from the map.
   */
  async readCurrent(config, http: HttpClient, externalRefs) {
    const out = new Map<string, Record<string, string | null>>();
    const refs = [...new Set(externalRefs)].filter((r) => r.length > 0);
    if (refs.length === 0) return out;
    const { base, auth } = snBase(config);
    const params = new URLSearchParams({
      sysparm_query: `sys_idIN${refs.join(",")}`,
      sysparm_fields: ["sys_id", ...WRITEBACK_FIELDS].join(","),
      sysparm_display_value: "false",
      sysparm_exclude_reference_link: "true",
      sysparm_limit: String(refs.length)
    });
    const url = `${base}/api/now/table/cmdb_ci?${params.toString()}`;
    const raw = await http.getJson(url, { Authorization: `Basic ${auth}`, Accept: "application/json" });
    const result = (raw as { result?: unknown } | null)?.result;
    if (!Array.isArray(result)) return out;
    for (const row of result as Array<Record<string, unknown>>) {
      const sysId = typeof row.sys_id === "string" ? row.sys_id : undefined;
      if (!sysId) continue;
      const fields: Record<string, string | null> = {};
      for (const f of WRITEBACK_FIELDS) {
        const v = row[f];
        fields[f] = typeof v === "string" && v.length > 0 ? v : null;
      }
      out.set(sysId, fields);
    }
    return out;
  },

  /** Assert the given field values on one CI (PATCH the CMDB table row). */
  async writeField(config, http: HttpClient, externalRef, values) {
    const patchJson = requirePatchJson(http, "servicenow_cmdb");
    const { base, auth } = snBase(config);
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if ((WRITEBACK_FIELDS as readonly string[]).includes(k)) body[k] = v;
    }
    if (Object.keys(body).length === 0) return;
    const url = `${base}/api/now/table/cmdb_ci/${encodeURIComponent(externalRef)}`;
    await patchJson(url, { Authorization: `Basic ${auth}`, Accept: "application/json" }, body);
  }
};

export const serviceNowCmdbAdapter: ConnectorAdapter = {
  id: "servicenow_cmdb",
  displayName: "ServiceNow CMDB",
  status: "reference",
  category: "cmdb",
  configFields: CONFIG_FIELDS,
  writeback: serviceNowWriteback,

  validateConfig(raw) {
    return validateAgainstFields(raw, CONFIG_FIELDS);
  },

  async fetch(config, http: HttpClient) {
    return fetchCis(config, http, null);
  },

  /**
   * ERIP-AD-10 (E2.P2): incremental fetch. On a cursor with `sys_updated_on`,
   * fetch only CIs changed since that watermark (ServiceNow encoded query
   * `sys_updated_on>VALUE`). A null cursor performs a full fetch (seed). The
   * next watermark is the max `sys_updated_on` seen this run, so a run that
   * returns nothing leaves the stored cursor unchanged (next_cursor null).
   */
  async fetchDelta(config, http: HttpClient, cursor) {
    const since = cursor?.sys_updated_on ?? null;
    const raw = await fetchCis(config, http, since);
    const result = (raw as { result?: unknown } | null)?.result;
    let maxUpdated = since;
    if (Array.isArray(result)) {
      for (const ci of result as Array<{ sys_updated_on?: unknown }>) {
        const u = typeof ci.sys_updated_on === "string" ? ci.sys_updated_on : null;
        if (u && (maxUpdated === null || u > maxUpdated)) maxUpdated = u;
      }
    }
    const next_cursor = maxUpdated && maxUpdated !== since ? { sys_updated_on: maxUpdated } : null;
    return { raw, next_cursor };
  },

  normalize(raw): NormalizedInventory {
    const result = (raw as { result?: unknown } | null)?.result;
    if (!Array.isArray(result)) return { entities: [], relationships: [] };

    const entities: NormalizedEntity[] = [];
    const relationships: NormalizedRelationship[] = [];
    const seen = new Set<string>();

    for (const rowUnknown of result as CmdbCi[]) {
      const sysId = str(rowUnknown.sys_id);
      const name = str(rowUnknown.name);
      if (!sysId || !name || seen.has(sysId)) continue;
      seen.add(sysId);

      const entity_type = classToEntityType(str(rowUnknown.sys_class_name) ?? "");
      const entity: NormalizedEntity = { entity_type, name, external_ref: sysId };
      const desc = str(rowUnknown.short_description);
      if (desc) entity.description = desc;
      const crit = mapCriticality(rowUnknown.business_criticality);
      if (crit) entity.criticality = crit;
      // E2.P4 (ERIP-AD-13): owner hint (suggest-only) + source-echo metadata.
      const owner = str(rowUnknown.assigned_to) ?? str(rowUnknown.owned_by);
      if (owner) entity.owner_hint = owner;
      const metadata: Record<string, string> = {};
      const os = str(rowUnknown.os);
      if (os) metadata.os = os;
      const ip = str(rowUnknown.ip_address);
      if (ip) metadata.ip_address = ip;
      if (Object.keys(metadata).length > 0) entity.metadata = metadata;
      entities.push(entity);

      // Dependency edges: this CI depends_on the listed CIs (by sys_id).
      if (Array.isArray(rowUnknown.depends_on)) {
        for (const depUnknown of rowUnknown.depends_on) {
          const dep = str(depUnknown);
          if (dep) relationships.push({ from_external_ref: sysId, to_external_ref: dep, relationship_type: "depends_on" });
        }
      }
    }

    // Deterministic ordering (persistence/import order must not matter).
    entities.sort((a, b) => (a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0));
    relationships.sort((a, b) => {
      const ka = `${a.from_external_ref}|${a.to_external_ref}|${a.relationship_type}`;
      const kb = `${b.from_external_ref}|${b.to_external_ref}|${b.relationship_type}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return { entities, relationships };
  }
};
