/**
 * enterpriseContextImport.ts — ECL Slice 3: pure import-planning core.
 *
 * The deterministic heart of CSV/spreadsheet bulk import (the no-integration
 * onboarding path). NO I/O — given parsed rows + the set of existing dedup keys +
 * the remaining capacity headroom, it produces a per-row plan
 * (ok / invalid / duplicate / cap_exceeded) and a summary. The route layer handles
 * parsing (exceljs), reading existing keys, computing cap headroom, and — in commit
 * mode — persisting the `ok` rows. Preview mode returns the plan without writing.
 *
 * "Extend, don't duplicate": each entity type dispatches to the SAME validator the
 * manual create path uses — `validateEnterpriseEntityCreate` (assets/apps/data_stores),
 * `validateVendorCreate` (vendors), `validateAiSystemCreate` (ai_systems). Import adds
 * no second validation truth.
 *
 * Cap systems (the route supplies the correct headroom; this core is cap-agnostic):
 *   - asset/application/data_store → `enforceEnterpriseEntityLimit` (max_enterprise_entities)
 *   - vendor/ai_system            → `enforceEntityLimit` (max_monitored_entities, SHARED)
 * One import = one entity type, so one cap system per import.
 *
 * Pure ⇒ fully unit-testable (malformed rows / dedup / cap-exceeded), reproducible from
 * identical inputs.
 */

import {
  validateEnterpriseEntityCreate,
  type EnterpriseEntityCreateInput
} from "./enterpriseEntityValidation.js";
import { validateVendorCreate, type VendorCreateInput } from "./vendorValidation.js";
import { validateAiSystemCreate, type AiSystemCreateInput } from "./aiSystemValidation.js";

/**
 * The importable entity types. asset/application/data_store/vendor/ai_system =
 * the original no-integration onboarding set (Slice 3); `identity` added in R7
 * for the identity-provider connector (connectors reuse THIS import path, and
 * IdP users normalize to `identity` entities). identity rows flow through the
 * same enterprise-entity branch below — the manual-create validator already
 * accepts entity_type 'identity'.
 */
export const IMPORT_ENTITY_TYPES = [
  "asset",
  "application",
  "data_store",
  "vendor",
  "ai_system",
  "identity",
  // EAR P16: business_process joined the importable set (it is a valid
  // enterprise_entities entity_type since migration 20260827). It flows through
  // the same enterprise-entity branch below and persists to enterprise_entities
  // (see ENTERPRISE_TYPES in enterpriseImportPersistence.ts) — no new validator.
  "business_process"
] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

export function isImportEntityType(v: unknown): v is ImportEntityType {
  return typeof v === "string" && (IMPORT_ENTITY_TYPES as readonly string[]).includes(v);
}

/** A parsed spreadsheet row: header → cell value (already string-normalized by the parser). */
export type ImportRow = Record<string, string | null | undefined>;

export type NormalizedImportInput =
  | { kind: "enterprise_entity"; input: EnterpriseEntityCreateInput }
  | { kind: "vendor"; input: VendorCreateInput }
  | { kind: "ai_system"; input: AiSystemCreateInput };

export type RowStatus = "ok" | "invalid" | "duplicate_in_file" | "duplicate_in_db" | "cap_exceeded";

export interface RowPlan {
  /** 1-based row number (data rows; header excluded). */
  rowNumber: number;
  status: RowStatus;
  /** The dedup key used (lowercased name); present for every non-invalid row. */
  key?: string;
  /** Validator error code + optional detail, for status === "invalid". */
  error?: string;
  detail?: string;
  /** Normalized create input, for status === "ok" (what commit mode persists). */
  normalized?: NormalizedImportInput;
}

export interface ImportPlan {
  entityType: ImportEntityType;
  rows: RowPlan[];
  summary: {
    total: number;
    ok: number;
    invalid: number;
    duplicate: number;
    cap_exceeded: number;
  };
}

// ---------------------------------------------------------------------------
// Per-type adapters: map a flat spreadsheet row to the validator's body shape,
// then reuse the existing manual-create validator. Returns the normalized input
// or a validation error — NO new validation logic.
// ---------------------------------------------------------------------------

/** Parse a spreadsheet cell into a boolean, or null when blank/absent. */
function parseBool(v: string | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "") return null;
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null; // unrecognized → treat as unset (validator sees null)
}

/** Trim a cell; empty → undefined so the validators treat it as absent. */
function cell(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

type AdaptResult =
  | { ok: true; normalized: NormalizedImportInput; key: string }
  | { ok: false; error: string; detail?: string | undefined };

function adaptRow(entityType: ImportEntityType, row: ImportRow): AdaptResult {
  const name = cell(row["name"]);

  if (entityType === "vendor") {
    const r = validateVendorCreate({
      name,
      service_description: cell(row["service_description"]),
      category: cell(row["category"]),
      criticality: cell(row["criticality"]),
      data_sensitivity: cell(row["data_sensitivity"]),
      access_level: cell(row["access_level"]),
      website: cell(row["website"]),
      owner_user_id: cell(row["owner_user_id"])
    });
    if ("error" in r) return { ok: false, error: r.error, detail: (r as { detail?: string }).detail };
    return { ok: true, normalized: { kind: "vendor", input: r.input }, key: r.input.name.trim().toLowerCase() };
  }

  if (entityType === "ai_system") {
    const r = validateAiSystemCreate({
      name,
      use_case: cell(row["use_case"]),
      owner_user_id: cell(row["owner_user_id"]),
      model_type: cell(row["model_type"]),
      data_classification: cell(row["data_classification"]),
      deployment_status: cell(row["deployment_status"]),
      criticality: cell(row["criticality"]),
      risk_classification: cell(row["risk_classification"])
    });
    if ("error" in r) return { ok: false, error: r.error, detail: (r as { detail?: string }).detail };
    return { ok: true, normalized: { kind: "ai_system", input: r.input }, key: r.input.name.trim().toLowerCase() };
  }

  // asset | application | data_store | business_process → enterprise_entities
  // (+ typed child for data_store)
  const body: Record<string, unknown> = {
    entity_type: entityType,
    name,
    description: cell(row["description"]),
    owner_user_id: cell(row["owner_user_id"]),
    status: cell(row["status"]),
    criticality: cell(row["criticality"]),
    confidence: cell(row["confidence"]),
    external_ref: cell(row["external_ref"])
  };
  if (entityType === "data_store") {
    body["data_store"] = {
      data_classification: cell(row["data_classification"]) ?? null,
      residency_region: cell(row["residency_region"]) ?? null,
      retention_policy: cell(row["retention_policy"]) ?? null,
      encryption_at_rest: parseBool(row["encryption_at_rest"])
    };
  }
  const r = validateEnterpriseEntityCreate(body);
  if ("error" in r) return { ok: false, error: r.error, detail: (r as { detail?: string }).detail };
  return {
    ok: true,
    normalized: { kind: "enterprise_entity", input: r.input },
    key: r.input.name.trim().toLowerCase()
  };
}

// ---------------------------------------------------------------------------
// planImport — the deterministic core.
// ---------------------------------------------------------------------------

export interface PlanImportArgs {
  entityType: ImportEntityType;
  rows: ImportRow[];
  /** Lowercased dedup keys (names) that already exist in the org for this type. */
  existingKeys: ReadonlySet<string>;
  /**
   * Remaining capacity: how many NEW rows may be committed before the per-org cap is
   * hit (cap - current used). Rows beyond this (after validation + dedup) are marked
   * cap_exceeded. Negative/zero ⇒ every otherwise-ok row is cap_exceeded.
   */
  capHeadroom: number;
}

/**
 * A row adapter: map + validate one spreadsheet row into a normalized create
 * input (with a dedup key), or an error. This is the ONLY per-importer-specific
 * piece — the dedup/cap precedence is shared (planRows below).
 */
export type RowAdapter<N> = (
  row: ImportRow
) => { ok: true; normalized: N; key: string } | { ok: false; error: string; detail?: string | undefined };

export interface GenericRowPlan<N> {
  rowNumber: number;
  status: RowStatus;
  key?: string;
  error?: string;
  detail?: string;
  normalized?: N;
}

export interface PlanSummary {
  total: number;
  ok: number;
  invalid: number;
  duplicate: number;
  cap_exceeded: number;
}

export interface GenericPlan<N> {
  rows: GenericRowPlan<N>[];
  summary: PlanSummary;
}

/**
 * The deterministic dedup/cap precedence, generic over the normalized shape.
 * Order per row: invalid → duplicate_in_file → duplicate_in_db → cap_exceeded → ok.
 * Shared by the ECL importer (planImport) and the detail-backed asset importer
 * (planAssetImport) — one precedence truth, adapters differ. No I/O; deterministic.
 */
export function planRows<N>(
  rows: ImportRow[],
  adapt: RowAdapter<N>,
  existingKeys: ReadonlySet<string>,
  capHeadroom: number
): GenericPlan<N> {
  const seen = new Set<string>();
  let okCount = 0;
  const summary: PlanSummary = { total: rows.length, ok: 0, invalid: 0, duplicate: 0, cap_exceeded: 0 };
  const out: GenericRowPlan<N>[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 1;
    const adapted = adapt(row);

    if (!adapted.ok) {
      summary.invalid++;
      const plan: GenericRowPlan<N> = { rowNumber, status: "invalid", error: adapted.error };
      if (adapted.detail !== undefined) plan.detail = adapted.detail;
      out.push(plan);
      return;
    }

    const key = adapted.key;
    if (seen.has(key)) {
      summary.duplicate++;
      out.push({ rowNumber, status: "duplicate_in_file", key });
      return;
    }
    if (existingKeys.has(key)) {
      summary.duplicate++;
      out.push({ rowNumber, status: "duplicate_in_db", key });
      return;
    }

    if (okCount >= capHeadroom) {
      summary.cap_exceeded++;
      out.push({ rowNumber, status: "cap_exceeded", key });
      return;
    }

    seen.add(key);
    okCount++;
    summary.ok++;
    out.push({ rowNumber, status: "ok", key, normalized: adapted.normalized });
  });

  return { rows: out, summary };
}

/**
 * Produce the per-row ECL import plan. Delegates the precedence to the shared
 * `planRows` core; the only ECL-specific piece is `adaptRow`.
 */
export function planImport(args: PlanImportArgs): ImportPlan {
  const { entityType, rows, existingKeys, capHeadroom } = args;
  const plan = planRows<NormalizedImportInput>(rows, (row) => adaptRow(entityType, row), existingKeys, capHeadroom);
  return { entityType, rows: plan.rows, summary: plan.summary };
}
