/**
 * contributorScope.ts — the row-level enforcement primitives for Contributor
 * seats. Centralizes the "assigned/owned only" rule so scoped routes call a
 * helper instead of hand-rolling a predicate (which is how leaks happen).
 *
 * All three helpers are inert unless SECURELOGIC_SEAT_MODEL_ENABLED is on AND
 * the caller resolves to an 'assigned' read scope (i.e. a Contributor seat).
 * For everyone else — Full, Viewer, API-key — they are transparent, so wiring
 * them into a route is byte-identical to today until the flag is switched on.
 *
 * Fail closed: a Contributor with no resolvable user identity is denied
 * everything (a guaranteed-false predicate on lists; false on ownership checks).
 */

import type { Request, Response } from "express";
import { getSeatScope, seatModelEnabled } from "../middleware/requireSeat.js";
import { projectForContributor, type ProjectedRow } from "./contributorProjection.js";

/** True when the caller is a Contributor (assigned-only) under an enabled model. */
export function isAssignedScope(req: Request): boolean {
  if (!seatModelEnabled()) return false;
  return getSeatScope(req).readScope === "assigned";
}

function scopedUserId(req: Request): string | null {
  return (req as { userId?: string }).userId ?? null;
}

/**
 * Append an ownership predicate to a dynamically-built query for a
 * Contributor-scoped caller. MUTATES `params` (pushes the user id) and returns
 * the SQL condition string to add to the WHERE list, or null when no
 * restriction applies (Full / Viewer / API-key / flag off).
 *
 * A Contributor with no user identity yields `1 = 0` — deny everything — rather
 * than an unbounded query.
 */
export function ownerCondition(
  req: Request,
  column: string,
  params: unknown[]
): string | null {
  if (!isAssignedScope(req)) return null;
  const uid = scopedUserId(req);
  if (!uid) return "1 = 0";
  params.push(uid);
  return `${column} = $${params.length}`;
}

/**
 * Detail / mutation guard. Returns true when the caller may act on an object
 * with the given owner. Non-Contributors always pass. A Contributor passes only
 * for their own objects; a false result means the handler MUST return 404 —
 * non-disclosing, indistinguishable from "does not exist".
 */
export function mayAccessOwned(req: Request, ownerUserId: string | null | undefined): boolean {
  if (!isAssignedScope(req)) return true;
  const uid = scopedUserId(req);
  return uid !== null && ownerUserId === uid;
}

/**
 * Assignment guard for assessment/response families. For a Contributor-scoped
 * caller, verifies the row `id` in `table` exists in the org AND is assigned to
 * them (`assigned_to_user_id`); otherwise responds 404 (non-disclosing) and
 * returns false so the handler returns early. Non-Contributors pass through
 * (returns true, no query). Used for BOTH detail reads and the respond/update
 * path — a Contributor may act only on assessments assigned to them, and can
 * never create one (create routes stay denyContributor).
 *
 * `table` is always a fixed string literal at the call site (never user input),
 * so the interpolation carries no injection surface.
 */
export async function assertAssignedOr404(
  req: Request,
  res: Response,
  pgLike: { query: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null; rows: Array<{ assigned_to_user_id?: string | null }> }> },
  table: string,
  id: string,
  organizationId: string,
  notFoundError: string
): Promise<boolean> {
  if (!isAssignedScope(req)) return true;
  const r = await pgLike.query(
    `SELECT assigned_to_user_id FROM ${table} WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  if ((r.rowCount ?? 0) === 0 || !mayAccessOwned(req, r.rows[0]?.assigned_to_user_id)) {
    res.status(404).json({ error: notFoundError });
    return false;
  }
  return true;
}

/**
 * Project a response row for the caller. Non-Contributors get the row verbatim.
 * A Contributor gets the bounded projection for `objectType`; if none is
 * registered the result is null and the caller must deny (404) rather than leak.
 */
export function projectForReq(
  req: Request,
  objectType: string,
  row: Record<string, unknown>
): Record<string, unknown> | ProjectedRow | null {
  if (!isAssignedScope(req)) return row;
  return projectForContributor(objectType, row);
}

/** Project a list of rows for the caller (verbatim for non-Contributors). */
export function projectListForReq(
  req: Request,
  objectType: string,
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!isAssignedScope(req)) return rows;
  return rows
    .map((r) => projectForContributor(objectType, r))
    .filter((r): r is ProjectedRow => r !== null);
}
