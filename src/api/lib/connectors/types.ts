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
 * only I/O and takes an injected `HttpClient` so it is testable with a fake. Nothing
 * here writes to the DB or is wired into a route/worker — connectors ship DARK behind
 * `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` + a per-connector flag at the eventual call
 * site. Real credentials are operator-owned (see the operator ledger).
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
}

export type ConnectorStatus = "reference" | "planned";

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
