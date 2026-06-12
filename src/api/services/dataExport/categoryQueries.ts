/**
 * categoryQueries.ts — parameterized SELECTs for a user self-export, derived from
 * the classification in src/api/lib/dataClassification.ts. PR #2a builds these;
 * PR #2b consumes them inside a `withTenant(orgId)` callback.
 *
 * Coverage is enforced by src/api/__tests__/dataClassification.test.ts: every
 * Category-B and Category-C table (except the explicit export exclusions) and
 * every `exportByEmailOnly` table must be produced by a builder here, so a future
 * migration that adds such a table can't silently escape the export.
 *
 * Matching rules:
 *   • A (`users`)               id = $userId (the subject's own row).
 *   • B (user-scoped)           userRef column(s) = $userId.
 *   • C (authored content)      (UUID actor col = $userId) OR (legacy TEXT actor
 *                               col = $userEmail). The TEXT columns are the
 *                               deprecated `reviewer_id` set (pre-20260503) that
 *                               may hold a raw email — Decision Q5.
 *   • email-keyed (Cat-E,       email column = $userEmail — Decision Q6.
 *     exportByEmailOnly)
 *
 * Org-scoping is NOT added to the WHERE clauses — it is the `withTenant` caller's
 * job (Decision Q1/Q2). `subscribers` is the lone table with no `organization_id`
 * (platform-level); there the unique email is the only boundary.
 *
 * SELECT projection: most tables are `SELECT *`. A table that declares
 * `exportExcludedColumns` (credentials / capability tokens — `users`,
 * `org_invites`) is projected as an explicit allowlist of every column EXCEPT the
 * excluded ones; the live column list is supplied via `tableColumns` (resolved by
 * `columnProbe.ts`). If that list is missing for such a table the builder THROWS
 * rather than fall back to `SELECT *` (fail-closed — no secret leak).
 */

import {
  TABLE_CLASSIFICATION,
  type DataCategory,
} from "../../lib/dataClassification.js";
import type { ExportQuery, ExportSubject, TableColumns } from "./types.js";

/** The `users` PII-root table (Category A). */
const USERS_TABLE = "users";

/**
 * Tables that are classified for retention purposes but are NEVER included in a
 * data export (user_self OR org_full). The coverage test exempts these.
 *   • `password_history`           — password hashes (PR #2a).
 *   • `jobs` / `data_export_files` — operational metadata ABOUT the export
 *     process itself, not the user's/org's data (Decision Q7, PR #2b). Both are
 *     Category E so the category filters already skip them; listing them here is
 *     belt-and-suspenders and documents the intent for the org_full dump, which
 *     would otherwise be tempted to include every org-scoped row.
 */
export const EXPORT_EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  "password_history",
  "jobs",
  "data_export_files",
]);

/**
 * (table → column[]) for the deprecated, un-FK'd TEXT `reviewer_id` columns that
 * may hold a raw email/name instead of a `users.id` UUID (the five tables from
 * 20260503_reviewer_id_uuid_fk.sql). Matched against `$userEmail`. Kept explicit
 * — and keyed by (table, column) — because `reviewer_id` is *also* a UUID FK in
 * `control_assessments` / `vendor_assessments` / `governance_reviews`, so the
 * column name alone is ambiguous. See docs/investigation/gdpr-pr2-phase0.md §2.1.
 */
const LEGACY_TEXT_ACTOR_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  risk_treatments: ["reviewer_id"],
  obligation_assessments: ["reviewer_id"],
  vendor_reviews: ["reviewer_id"],
  ai_governance_assessments: ["reviewer_id"],
  dependency_assessments: ["reviewer_id"],
};

/**
 * (table → email column) for the `exportByEmailOnly` tables. The classification
 * marks WHICH tables are email-keyed; this map records the column name, which the
 * classification does not carry. Verified against db/migrations/.
 */
export const EMAIL_KEYED_COLUMNS: Readonly<Record<string, string>> = {
  subscribers: "email",
  intelligence_brief_subscribers: "email",
  newsletter_deliveries: "subscriber_email",
};

export interface CategoryCOptions {
  /**
   * Whether `dependency_assessments.reviewer_uuid` exists (Decision Q3 probe).
   * Defaults to `true`. When `false`, that column is dropped from the predicate
   * and the table falls back to matching its legacy TEXT `reviewer_id` only.
   */
  dependencyAssessmentsReviewerUuidPresent?: boolean;
}

function tablesInCategory(category: DataCategory): string[] {
  return Object.entries(TABLE_CLASSIFICATION)
    .filter(([, c]) => c.category === category)
    .map(([table]) => table);
}

function userRefColumnsOrThrow(table: string): string[] {
  const cols = TABLE_CLASSIFICATION[table]?.userRefColumns;
  if (!cols || cols.length === 0) {
    throw new Error(
      `categoryQueries: table "${table}" needs userRefColumns to build an export query but has none. ` +
        `Add them to dataClassification.ts (and the doc) or mark the table excluded.`,
    );
  }
  return cols;
}

/**
 * Build an OR predicate from UUID-matched and email-matched columns, reusing a
 * single positional parameter for the id and a single one for the email. Returns
 * the WHERE body (no `WHERE` keyword) and its ordered values.
 */
function actorPredicate(
  uuidColumns: readonly string[],
  emailColumns: readonly string[],
  subject: ExportSubject,
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const parts: string[] = [];

  if (uuidColumns.length > 0) {
    values.push(subject.userId);
    const p = values.length;
    for (const col of uuidColumns) parts.push(`${col} = $${p}`);
  }
  if (emailColumns.length > 0) {
    values.push(subject.userEmail);
    const p = values.length;
    for (const col of emailColumns) parts.push(`${col} = $${p}`);
  }

  if (parts.length === 0) {
    throw new Error("actorPredicate: no columns to match (this is a classification bug)");
  }
  return { text: parts.join(" OR "), values };
}

/** Double-quote a SQL identifier (column/table). Inputs are schema-derived. */
function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * The SELECT projection for a table. `*` for the common case, but for any table
 * with `exportExcludedColumns` (credentials / capability tokens) an explicit
 * allowlist of every column EXCEPT the excluded ones — built from the live column
 * list supplied via `tableColumns`.
 *
 * FAIL-CLOSED: if a table declares `exportExcludedColumns` but no column list is
 * supplied, this throws rather than emit `SELECT *` — refusing to build a query
 * that could leak the excluded secrets. The executor (PR #2b) must probe the
 * column list (`columnProbe.ts`) for `tablesRequiringProjection()` and pass it in.
 */
export function buildProjection(table: string, tableColumns?: TableColumns): string {
  const excluded = TABLE_CLASSIFICATION[table]?.exportExcludedColumns;
  if (!excluded || excluded.length === 0) return "*";

  const columns = tableColumns?.[table];
  if (!columns || columns.length === 0) {
    throw new Error(
      `categoryQueries: table "${table}" declares exportExcludedColumns and must not be exported as SELECT *. ` +
        `Provide its live column list via tableColumns (columnProbe.getTableColumns). ` +
        `Refusing to build a query that could leak: ${excluded.join(", ")}.`,
    );
  }

  const excludedSet = new Set(excluded);
  const projected = columns.filter((c) => !excludedSet.has(c));
  if (projected.length === 0) {
    throw new Error(`categoryQueries: projection for "${table}" is empty after applying exportExcludedColumns.`);
  }
  return projected.map(quoteIdent).join(", ");
}

/** Category A — the subject's own `users` row (secrets projected out). */
export function buildCategoryAQuery(
  subject: ExportSubject,
  tableColumns?: TableColumns,
): ExportQuery {
  return {
    table: USERS_TABLE,
    category: "A",
    text: `SELECT ${buildProjection(USERS_TABLE, tableColumns)} FROM ${USERS_TABLE} WHERE id = $1`,
    values: [subject.userId],
  };
}

/** Category B — user-scoped tables (minus whole-table export exclusions). */
export function buildCategoryBQueries(
  subject: ExportSubject,
  tableColumns?: TableColumns,
): ExportQuery[] {
  return tablesInCategory("B")
    .filter((table) => !EXPORT_EXCLUDED_TABLES.has(table))
    .map((table) => {
      const cols = userRefColumnsOrThrow(table);
      // B columns are all UUID user FKs.
      const { text, values } = actorPredicate(cols, [], subject);
      return {
        table,
        category: "B" as const,
        text: `SELECT ${buildProjection(table, tableColumns)} FROM ${table} WHERE ${text}`,
        values,
      };
    });
}

/** Category C — org content authored by the subject (UUID OR legacy-email match). */
export function buildCategoryCQueries(
  subject: ExportSubject,
  opts: CategoryCOptions = {},
  tableColumns?: TableColumns,
): ExportQuery[] {
  const reviewerUuidPresent = opts.dependencyAssessmentsReviewerUuidPresent ?? true;

  return tablesInCategory("C")
    .filter((table) => !EXPORT_EXCLUDED_TABLES.has(table))
    .map((table) => {
      const allCols = userRefColumnsOrThrow(table);
      const emailCols = LEGACY_TEXT_ACTOR_COLUMNS[table] ?? [];
      const emailColSet = new Set(emailCols);

      let uuidCols = allCols.filter((c) => !emailColSet.has(c));

      let note: string | undefined;
      if (table === "dependency_assessments" && !reviewerUuidPresent) {
        uuidCols = uuidCols.filter((c) => c !== "reviewer_uuid");
        note = "reviewer_uuid absent on this deployment (Q3 probe) — matched legacy reviewer_id only";
      }

      const { text, values } = actorPredicate(uuidCols, emailCols, subject);
      const query: ExportQuery = {
        table,
        category: "C",
        text: `SELECT ${buildProjection(table, tableColumns)} FROM ${table} WHERE ${text}`,
        values,
      };
      return note ? { ...query, note } : query;
    });
}

/** `exportByEmailOnly` tables (Category E) — matched by the subject's current email. */
export function buildEmailKeyedQueries(
  subject: ExportSubject,
  tableColumns?: TableColumns,
): ExportQuery[] {
  return Object.entries(TABLE_CLASSIFICATION)
    .filter(([, c]) => c.exportByEmailOnly === true)
    .map(([table]) => {
      const column = EMAIL_KEYED_COLUMNS[table];
      if (!column) {
        throw new Error(
          `categoryQueries: exportByEmailOnly table "${table}" has no email column mapped in EMAIL_KEYED_COLUMNS.`,
        );
      }
      return {
        table,
        category: TABLE_CLASSIFICATION[table]!.category,
        text: `SELECT ${buildProjection(table, tableColumns)} FROM ${table} WHERE ${column} = $1`,
        values: [subject.userEmail],
      };
    });
}

/**
 * All category-derived self-export queries (A + B + C + email-keyed). Historical
 * authorship (`security_audit_log`) is added separately by `historicalAuthorship.ts`.
 *
 * `tableColumns` must contain the live column list for every table in
 * `tablesRequiringProjection()` (those with `exportExcludedColumns`), or building
 * those tables' queries throws (fail-closed). All other tables ignore it.
 */
export function buildCategoryQueries(
  subject: ExportSubject,
  opts: CategoryCOptions = {},
  tableColumns?: TableColumns,
): ExportQuery[] {
  return [
    buildCategoryAQuery(subject, tableColumns),
    ...buildCategoryBQueries(subject, tableColumns),
    ...buildCategoryCQueries(subject, opts, tableColumns),
    ...buildEmailKeyedQueries(subject, tableColumns),
  ];
}
