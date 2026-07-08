/**
 * assetImportPlan.ts — EAR P16: pure import-planning core for the four
 * detail-backed asset types (cloud_resource / endpoint / api / identity_system).
 *
 * The sibling of enterpriseContextImport.ts for the assets spine. It adds NO new
 * validation and NO new dedup/cap precedence:
 *   - each row is validated by the EXISTING `validateAssetDetailCreate` (the same
 *     validator POST /api/assets uses — "no second validation truth"), and
 *   - the deterministic invalid → dup_in_file → dup_in_db → cap_exceeded → ok
 *     precedence is the SHARED `planRows` core from enterpriseContextImport.ts.
 *
 * Vendor / ai_system / application / database / business_process / generic are
 * NOT handled here — they import through the ECL path (enterpriseContextImport).
 * This module is detail-backed-only, mirroring the create federation (EAR-AD-1).
 *
 * Pure ⇒ fully unit-testable; the route layer supplies parsing (parseImportFile),
 * existing dedup keys, cap headroom, and — in commit mode — persistence
 * (createDetailAsset, the same lane POST /api/assets writes through).
 */

import {
  validateAssetDetailCreate,
  DETAIL_TABLE_SPEC,
  isDetailBackedType,
  type AssetDetailCreateInput,
  type DetailBackedType
} from "./assetDetailValidation.js";
import { planRows, type ImportRow, type GenericPlan } from "./enterpriseContextImport.js";

export { isDetailBackedType, type DetailBackedType };

/** Trim a cell; empty → undefined so the validator treats it as absent. */
function cell(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

/**
 * The expected spreadsheet columns for a detail-backed type: the shared header
 * columns plus the type's typed columns (from DETAIL_TABLE_SPEC — the single
 * source of truth). Used by the template generator + the column hint in the UI.
 * `name` is the only required column (provider is required for cloud_resource,
 * enforced by the validator, and is one of its typed columns).
 */
export function assetImportColumns(assetType: DetailBackedType): string[] {
  return ["name", "criticality", "status", "external_ref", ...DETAIL_TABLE_SPEC[assetType].typedColumns];
}

/**
 * Adapt one spreadsheet row to the detail-backed create body, then reuse the
 * existing validator. Returns the normalized create input + dedup key (lowercased
 * name) or a validator error code — no new validation logic.
 */
export function adaptAssetRow(
  assetType: DetailBackedType,
  row: ImportRow
): { ok: true; normalized: AssetDetailCreateInput; key: string } | { ok: false; error: string; detail?: string | undefined } {
  const body: Record<string, unknown> = {
    asset_type: assetType,
    name: cell(row["name"]),
    criticality: cell(row["criticality"]),
    status: cell(row["status"]),
    external_ref: cell(row["external_ref"])
  };
  // Typed columns are read as top-level keys by validateAssetDetailCreate.
  for (const col of DETAIL_TABLE_SPEC[assetType].typedColumns) {
    body[col] = cell(row[col]);
  }
  const r = validateAssetDetailCreate(body);
  if ("error" in r) return { ok: false, error: r.error, detail: (r as { detail?: string }).detail };
  return { ok: true, normalized: r.input, key: r.input.name.trim().toLowerCase() };
}

export interface PlanAssetImportArgs {
  assetType: DetailBackedType;
  rows: ImportRow[];
  /** Lowercased dedup keys (names) already in the org for this detail type. */
  existingKeys: ReadonlySet<string>;
  /** Remaining capacity (cap - used) before the per-type row cap is hit. */
  capHeadroom: number;
}

export interface AssetImportPlan extends GenericPlan<AssetDetailCreateInput> {
  assetType: DetailBackedType;
}

/**
 * The per-row plan for a detail-backed asset import. Delegates the precedence to
 * the shared `planRows`; the only asset-specific piece is `adaptAssetRow`.
 */
export function planAssetImport(args: PlanAssetImportArgs): AssetImportPlan {
  const { assetType, rows, existingKeys, capHeadroom } = args;
  const plan = planRows<AssetDetailCreateInput>(rows, (row) => adaptAssetRow(assetType, row), existingKeys, capHeadroom);
  return { assetType, rows: plan.rows, summary: plan.summary };
}
