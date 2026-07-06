/**
 * types.ts — Connector framework for the Enterprise Context Layer (Slice 8).
 *
 * A connector pulls inventory from an external system (ServiceNow CMDB, Defender,
 * CrowdStrike, Wiz, Tenable/Qualys/Rapid7, cloud, identity) and NORMALIZES it into
 * the ECL import shape — the same entity types Slice 3's CSV import produces
 * (`IMPORT_ENTITY_TYPES`) plus intra-org relationships. The normalized output is fed
 * to the existing import path (`planImport`), so connectors reuse the manual-create
 * validators + cap + dedup rather than a parallel write path.
 *
 * Layering: `normalize()` is PURE (mock-testable with no network); `fetch()` is the
 * only I/O and takes an injected `HttpClient` so it is testable with a fake (prod =
 * the SSRF-safe connectorHttpClient). Since EAR Phase 3b, connectors are wired to the
 * sync route + worker (routes/connectors.ts, workers/connectorSyncWorker.ts), DARK
 * behind SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED AND SECURELOGIC_ASSET_REGISTRY_ENABLED;
 * per-connector activation is the org-level `enterprise_connectors.enabled` toggle
 * (row-level, not env — env flags cannot scale per-org). Real credentials are
 * operator-owned (see the operator ledger) and encrypted at rest (fieldEncryption).
 */

import type { ImportEntityType } from "../enterpriseContextImport.js";

/** A normalized entity ready for the ECL import path. Mirrors an import row. */
export interface NormalizedEntity {
  entity_type: ImportEntityType;
  name: string;
  /** Stable external identity (the connector's record id) — dedup + re-sync key. */
  external_ref: string;
  description?: string;
  criticality?: "critical" | "high" | "medium" | "low";
  /** Only for entity_type === 'data_store'. */
  data_store?: {
    data_classification?: "public" | "internal" | "confidential" | "restricted";
    residency_region?: string;
  };
}

/** A normalized intra-org relationship, keyed by the endpoints' external_ref. */
export interface NormalizedRelationship {
  from_external_ref: string;
  to_external_ref: string;
  relationship_type: "depends_on" | "runs_on" | "owned_by" | "part_of" | "serves" | "processes_data_in";
}

export interface NormalizedInventory {
  entities: NormalizedEntity[];
  relationships: NormalizedRelationship[];
}

/** One field of a connector's configuration schema (hand-written, per repo convention). */
export interface ConnectorConfigField {
  key: string;
  label: string;
  required: boolean;
  /** 'secret' fields are operator-provided credentials — never logged, never committed. */
  kind: "url" | "string" | "secret";
}

export type ConfigValidationResult =
  | { config: Record<string, string> }
  | { error: string; detail?: string };

/** Minimal injectable HTTP surface — a fake satisfies it in tests; prod uses the SSRF-safe client. */
export interface HttpClient {
  getJson(url: string, headers: Record<string, string>): Promise<unknown>;
  /**
   * POST application/x-www-form-urlencoded — the OAuth2 client-credentials leg
   * (Defender, Falcon, Wiz). Optional so pre-R7 fakes stay valid; adapters that
   * need it throw a typed error when the injected client lacks it.
   */
  postForm?(url: string, headers: Record<string, string>, form: Record<string, string>): Promise<unknown>;
  /** POST application/json (GraphQL-style APIs — Wiz). Optional, same contract as postForm. */
  postJson?(url: string, headers: Record<string, string>, body: unknown): Promise<unknown>;
}

/** Typed guard for adapters that need the optional POST legs. */
export function requirePostForm(http: HttpClient, connectorId: string): NonNullable<HttpClient["postForm"]> {
  if (!http.postForm) throw new Error(`connector_http_client_missing_post_form: ${connectorId}`);
  return http.postForm.bind(http);
}
export function requirePostJson(http: HttpClient, connectorId: string): NonNullable<HttpClient["postJson"]> {
  if (!http.postJson) throw new Error(`connector_http_client_missing_post_json: ${connectorId}`);
  return http.postJson.bind(http);
}

/**
 * 'reference' = the canonical fully-implemented adapter the others mirror;
 * 'implemented' = fetch+normalize implemented (R7); 'planned' = config schema only.
 */
export type ConnectorStatus = "reference" | "implemented" | "planned";

/**
 * ERIP-AD-10 (E2.P2): the per-(org,connector) incremental watermark. Adapter-
 * owned shape (opaque to the worker), persisted as enterprise_connectors
 * .sync_cursor. String values only — no timestamps-as-Date, no nesting.
 */
export type ConnectorCursor = Record<string, string>;

export interface DeltaFetchResult {
  raw: unknown;
  /** Watermark for the NEXT run; null = leave the stored cursor unchanged. */
  next_cursor: ConnectorCursor | null;
}

export interface ConnectorAdapter {
  id: string;
  displayName: string;
  /** 'reference' = fetch+normalize implemented; 'planned' = config schema only (normalize throws). */
  status: ConnectorStatus;
  category: "vulnerability" | "cmdb" | "cloud" | "identity" | "endpoint";
  configFields: ConnectorConfigField[];
  /** Validate a raw config object against configFields. Pure. */
  validateConfig(raw: unknown): ConfigValidationResult;
  /** Pull raw inventory from the external system. The only I/O; takes an injected client. */
  fetch(config: Record<string, string>, http: HttpClient): Promise<unknown>;
  /**
   * OPTIONAL incremental capability (ERIP-AD-10). Called with the stored
   * cursor (null = perform a FULL fetch and seed the watermark). Adapters
   * that don't implement it always full-sync via fetch(). Same I/O contract
   * as fetch: injected client only.
   */
  fetchDelta?(
    config: Record<string, string>,
    http: HttpClient,
    cursor: ConnectorCursor | null
  ): Promise<DeltaFetchResult>;
  /** Map raw inventory → the ECL import shape. Pure, deterministic. */
  normalize(raw: unknown): NormalizedInventory;
}

/** Shared config validator: checks required fields are present non-empty strings. */
export function validateAgainstFields(
  raw: unknown,
  fields: ConnectorConfigField[]
): ConfigValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "config_must_be_object" };
  }
  const obj = raw as Record<string, unknown>;
  const config: Record<string, string> = {};
  for (const f of fields) {
    const v = obj[f.key];
    if (v === undefined || v === null || v === "") {
      if (f.required) return { error: "config_field_missing", detail: `${f.key} is required` };
      continue;
    }
    if (typeof v !== "string") return { error: "config_field_type", detail: `${f.key} must be a string` };
    if (f.kind === "url" && !/^https:\/\//i.test(v.trim())) {
      return { error: "config_field_url", detail: `${f.key} must be an https URL` };
    }
    config[f.key] = v.trim();
  }
  return { config };
}

/** A 'planned' connector: config schema only; normalize/fetch throw until implemented. */
export function plannedAdapter(
  id: string,
  displayName: string,
  category: ConnectorAdapter["category"],
  configFields: ConnectorConfigField[]
): ConnectorAdapter {
  return {
    id,
    displayName,
    status: "planned",
    category,
    configFields,
    validateConfig(raw) {
      return validateAgainstFields(raw, configFields);
    },
    fetch() {
      return Promise.reject(new Error(`connector_not_implemented: ${id}`));
    },
    normalize() {
      throw new Error(`connector_not_implemented: ${id}`);
    }
  };
}
