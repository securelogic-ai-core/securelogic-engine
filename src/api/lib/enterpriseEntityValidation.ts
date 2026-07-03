/**
 * enterpriseEntityValidation.ts — Pure validation for enterprise_entities create/update.
 *
 * No I/O. No DB access. Fully unit-testable. Mirrors the shape of
 * signalMatchSuggestionValidation.ts ({ input } | { error, detail } union).
 *
 * Tenant rule: organization_id is NEVER sourced from the request body. It is
 * sourced exclusively from req.organizationContext at the route layer. owner_user_id
 * FORMAT is validated here; its same-org membership is verified at the route layer
 * with a pre-flight SELECT before persistence.
 *
 * Provenance: Slice 1 only writes provenance='manual' (set by the route, not the
 * body). source_type/source_id are not user-settable in Slice 1.
 */

import { sanitizeString } from "./sanitize.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const MAX_EXTERNAL_REF = 500;
const MAX_RESIDENCY = 100;
const MAX_RETENTION = 500;

export const ENTITY_TYPES = [
  "asset",
  "application",
  "business_service",
  "business_unit",
  "department",
  "data_store",
  "data_classification",
  "identity"
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_STATUSES = ["active", "archived", "retired"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const CRITICALITIES = ["critical", "high", "medium", "low"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const CONFIDENCES = ["high", "medium", "low", "unverified"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted"
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export type DataStoreInput = {
  data_classification: DataClassification | null;
  residency_region: string | null;
  retention_policy: string | null;
  encryption_at_rest: boolean | null;
};

export type EnterpriseEntityCreateInput = {
  entity_type: EntityType;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  status: EntityStatus;
  criticality: Criticality | null;
  confidence: Confidence | null;
  external_ref: string | null;
  /** Present only when entity_type === 'data_store'. */
  data_store: DataStoreInput | null;
};

/** Partial update — every field optional; entity_type is immutable (rejected). */
export type EnterpriseEntityUpdateInput = {
  name?: string;
  description?: string | null;
  owner_user_id?: string | null;
  status?: EntityStatus;
  criticality?: Criticality | null;
  confidence?: Confidence | null;
  external_ref?: string | null;
  data_store?: DataStoreInput;
};

export type CreateResult =
  | { input: EnterpriseEntityCreateInput }
  | { error: string; detail?: string };

export type UpdateResult =
  | { input: EnterpriseEntityUpdateInput }
  | { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

export function isEntityType(v: unknown): v is EntityType {
  return typeof v === "string" && (ENTITY_TYPES as readonly string[]).includes(v);
}

/** Validate an optional enum field; returns undefined-sentinel via the union. */
function checkEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  field: string
): { value: T | null } | { error: string; detail?: string } {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    return {
      error: `${field}_invalid`,
      detail: `${field} must be one of: ${allowed.join(", ")}`
    };
  }
  return { value: raw as T };
}

/** Validate an optional bounded string; null/empty → null. */
function checkString(
  raw: unknown,
  max: number,
  field: string
): { value: string | null } | { error: string; detail?: string } {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== "string") return { error: `${field}_must_be_string` };
  const trimmed = raw.trim();
  if (trimmed.length > max) {
    return { error: `${field}_too_long`, detail: `${field} must be ${max} characters or fewer` };
  }
  return { value: trimmed.length === 0 ? null : sanitizeString(trimmed, max) };
}

function validateDataStore(
  raw: unknown
): { value: DataStoreInput } | { error: string; detail?: string } {
  if (!isPlainObject(raw)) return { error: "data_store_must_be_object" };

  const cls = checkEnum(raw.data_classification, DATA_CLASSIFICATIONS, "data_classification");
  if ("error" in cls) return cls;
  const residency = checkString(raw.residency_region, MAX_RESIDENCY, "residency_region");
  if ("error" in residency) return residency;
  const retention = checkString(raw.retention_policy, MAX_RETENTION, "retention_policy");
  if ("error" in retention) return retention;

  let encryption: boolean | null = null;
  if (raw.encryption_at_rest !== null && raw.encryption_at_rest !== undefined) {
    if (typeof raw.encryption_at_rest !== "boolean") {
      return { error: "encryption_at_rest_must_be_boolean" };
    }
    encryption = raw.encryption_at_rest;
  }

  return {
    value: {
      data_classification: cls.value,
      residency_region: residency.value,
      retention_policy: retention.value,
      encryption_at_rest: encryption
    }
  };
}

/**
 * Validate the body of POST /api/enterprise-entities.
 * entity_type + name are required; everything else optional. A `data_store` object
 * is permitted only when entity_type === 'data_store'.
 */
export function validateEnterpriseEntityCreate(body: unknown): CreateResult {
  if (!isPlainObject(body)) return { error: "request_body_must_be_object" };

  if (!isEntityType(body.entity_type)) {
    return {
      error: "entity_type_invalid",
      detail: `entity_type must be one of: ${ENTITY_TYPES.join(", ")}`
    };
  }
  const entity_type = body.entity_type;

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return { error: "name_required" };
  }
  if (body.name.trim().length > MAX_NAME) {
    return { error: "name_too_long", detail: `name must be ${MAX_NAME} characters or fewer` };
  }
  const name = sanitizeString(body.name.trim(), MAX_NAME);

  const description = checkString(body.description, MAX_DESCRIPTION, "description");
  if ("error" in description) return description;

  let owner_user_id: string | null = null;
  if (body.owner_user_id !== null && body.owner_user_id !== undefined) {
    if (!isUuid(body.owner_user_id)) return { error: "owner_user_id_invalid" };
    owner_user_id = (body.owner_user_id as string).trim();
  }

  const status = checkEnum(body.status ?? "active", ENTITY_STATUSES, "status");
  if ("error" in status) return status;

  const criticality = checkEnum(body.criticality, CRITICALITIES, "criticality");
  if ("error" in criticality) return criticality;

  const confidence = checkEnum(body.confidence, CONFIDENCES, "confidence");
  if ("error" in confidence) return confidence;

  const external_ref = checkString(body.external_ref, MAX_EXTERNAL_REF, "external_ref");
  if ("error" in external_ref) return external_ref;

  let data_store: DataStoreInput | null = null;
  if (body.data_store !== null && body.data_store !== undefined) {
    if (entity_type !== "data_store") {
      return { error: "data_store_only_for_data_store_type" };
    }
    const ds = validateDataStore(body.data_store);
    if ("error" in ds) return ds;
    data_store = ds.value;
  }

  return {
    input: {
      entity_type,
      name,
      description: description.value,
      owner_user_id,
      status: status.value ?? "active",
      criticality: criticality.value,
      confidence: confidence.value,
      external_ref: external_ref.value,
      data_store
    }
  };
}

/**
 * Validate the body of PATCH /api/enterprise-entities/:id. Partial: only supplied
 * fields are validated + returned. entity_type is immutable — its presence is an error.
 */
export function validateEnterpriseEntityUpdate(body: unknown): UpdateResult {
  if (!isPlainObject(body)) return { error: "request_body_must_be_object" };
  if ("entity_type" in body) return { error: "entity_type_immutable" };

  const out: EnterpriseEntityUpdateInput = {};

  if ("name" in body) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return { error: "name_required" };
    }
    if (body.name.trim().length > MAX_NAME) {
      return { error: "name_too_long", detail: `name must be ${MAX_NAME} characters or fewer` };
    }
    out.name = sanitizeString(body.name.trim(), MAX_NAME);
  }

  if ("description" in body) {
    const d = checkString(body.description, MAX_DESCRIPTION, "description");
    if ("error" in d) return d;
    out.description = d.value;
  }

  if ("owner_user_id" in body) {
    if (body.owner_user_id === null) {
      out.owner_user_id = null;
    } else {
      if (!isUuid(body.owner_user_id)) return { error: "owner_user_id_invalid" };
      out.owner_user_id = (body.owner_user_id as string).trim();
    }
  }

  if ("status" in body) {
    const s = checkEnum(body.status, ENTITY_STATUSES, "status");
    if ("error" in s) return s;
    if (s.value === null) return { error: "status_invalid" };
    out.status = s.value;
  }

  if ("criticality" in body) {
    const c = checkEnum(body.criticality, CRITICALITIES, "criticality");
    if ("error" in c) return c;
    out.criticality = c.value;
  }

  if ("confidence" in body) {
    const c = checkEnum(body.confidence, CONFIDENCES, "confidence");
    if ("error" in c) return c;
    out.confidence = c.value;
  }

  if ("external_ref" in body) {
    const e = checkString(body.external_ref, MAX_EXTERNAL_REF, "external_ref");
    if ("error" in e) return e;
    out.external_ref = e.value;
  }

  if ("data_store" in body) {
    const ds = validateDataStore(body.data_store);
    if ("error" in ds) return ds;
    out.data_store = ds.value;
  }

  return { input: out };
}
