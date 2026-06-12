/**
 * dependencyAssessmentsProbe.ts — runtime presence check for
 * `dependency_assessments.reviewer_uuid` (Decision Q3).
 *
 * WHY A PROBE. `20260503_reviewer_id_uuid_fk.sql` adds `reviewer_uuid` inside a
 * guarded `DO $$ … $$` block that branches on whether the table was historically
 * named `dependency_reviews` (older lineages) vs `dependency_assessments` (fresh
 * installs). On some deployment lineages the column landed on the now-renamed
 * table and `dependency_assessments` does not carry `reviewer_uuid`. SELECTing a
 * missing column would error mid-export, so the C-table query builder asks this
 * probe first and falls back to the legacy TEXT `reviewer_id` predicate alone.
 *
 * The migration hygiene itself (the guarded DO block) is deliberately NOT fixed
 * here — that is a separate later PR (Decision Q3).
 */

import type { QueryRunner } from "./types.js";

export const DEPENDENCY_ASSESSMENTS_TABLE = "dependency_assessments";
export const REVIEWER_UUID_COLUMN = "reviewer_uuid";

/**
 * Returns true iff `dependency_assessments.reviewer_uuid` exists in the current
 * schema. Uses `information_schema.columns` scoped to `current_schema()` so it
 * reflects the schema the connection actually resolves against. Parameterized —
 * no string interpolation of identifiers.
 */
export async function dependencyAssessmentsHasReviewerUuid(
  run: QueryRunner,
): Promise<boolean> {
  const { rows } = await run(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [DEPENDENCY_ASSESSMENTS_TABLE, REVIEWER_UUID_COLUMN],
  );
  return rows.length > 0;
}
