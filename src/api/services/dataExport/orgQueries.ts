/**
 * orgQueries.ts — parameterized SELECTs for a FULL-ORGANIZATION export
 * (Decision Q2). PR #2b builds these as pure functions; PR #2c wires them into
 * `runExport({scope:'org_full'})` (member enumeration + R2 attachments).
 *
 * ── Model (Decision Q2/Q4) ───────────────────────────────────────────────────
 * An org export is a FULL TABLE DUMP, NOT a union of per-member self-exports:
 * every org-scoped Category-A/B/C/D table is selected in full with NO actor
 * predicate, so unassigned / NULL-actor rows are included. Output is flat — one
 * `tables/<t>.ndjson` per table for the whole org; rows carry their own
 * `*_user_id` columns for downstream partitioning.
 *
 * ── Org boundary (CRITICAL — do not rely on withTenant alone) ────────────────
 * Under owner credentials RLS is BYPASSED (NOT FORCE), and most tables have no
 * live policy yet (A04-G1 mid-flight), so `withTenant` + `SET LOCAL
 * app.current_org_id` does NOT by itself constrain a bare `SELECT * FROM t`.
 * Therefore EVERY query here carries an explicit org predicate (Q2's
 * "application-level for pending-RLS tables"); live RLS is defense-in-depth.
 * The scoping column per table:
 *   • `organizations`                      → `id = $1` (it IS the org row).
 *   • table has an `organization_id` column → `organization_id = $1` (the norm).
 *   • user-scoped table with NO org column  → membership subquery on its user
 *     ref(s): `<col> IN (SELECT id FROM users WHERE organization_id = $1)`.
 *
 * ── Email-keyed tables (Category E, Decision N4) ─────────────────────────────
 *   • `intelligence_brief_subscribers` (has organization_id) → ALL org
 *     subscribers via `organization_id = $1`.
 *   • `subscribers` / `newsletter_deliveries` (platform-level, no org column) →
 *     the UNION of current member emails via `<col> = ANY($1)`.
 *
 * ── Projection / secrets ─────────────────────────────────────────────────────
 * Same fail-closed `buildProjection` as the self-export: tables with
 * `exportExcludedColumns` (`users`, `org_invites`, `organizations`,
 * `webhook_endpoints`) are projected as an explicit allowlist; a missing column
 * list for such a table throws rather than emit a secret-leaking `SELECT *`.
 *
 * ── Deferred tables (PR #2c) ─────────────────────────────────────────────────
 * Five Category-D tables have neither an `organization_id` column nor a user
 * ref, so their org-scoping needs a parent join whose ownership semantics are
 * not yet settled (some may be global reference data). They are EXPLICITLY
 * deferred (see `ORG_EXPORT_DEFERRED_TABLES`) rather than silently dumped
 * cross-tenant or silently dropped; the coverage drift test asserts they are
 * the ONLY uncovered A/B/C/D tables.
 */

import {
  TABLE_CLASSIFICATION,
  type DataCategory,
} from "../../lib/dataClassification.js";
import type { ExportQuery, TableColumns } from "./types.js";
import {
  buildProjection,
  EMAIL_KEYED_COLUMNS,
  EXPORT_EXCLUDED_TABLES,
} from "./categoryQueries.js";

const ORGANIZATIONS_TABLE = "organizations";
const USERS_TABLE = "users";

/** Categories that make up an org's own data dump (Q2). E/F are excluded. */
const ORG_DUMP_CATEGORIES: ReadonlySet<DataCategory> = new Set<DataCategory>(["A", "B", "C", "D"]);

/**
 * Category-A/B/C/D tables that lack BOTH an `organization_id` column and a user
 * ref, so they cannot be org-scoped without a parent join whose semantics are
 * unsettled. Deferred to PR #2c. Kept in lockstep with the schema by the
 * coverage drift test (it asserts this set equals exactly the no-org-column,
 * no-user-ref A/B/C/D tables).
 */
export const ORG_EXPORT_DEFERRED_TABLES: ReadonlySet<string> = new Set([
  "requirements",
  "policy_control_links",
  "control_mappings",
  "obligation_mappings",
  "domain_scores",
]);

/**
 * Category-A/B/C/D tables that have NO `organization_id` column but ARE
 * user-scoped, so they are bounded to the org via a membership subquery on
 * their user ref(s). Kept in lockstep with the schema by the coverage drift
 * test (it asserts this set equals exactly the no-org-column A/B/C/D tables
 * that DO carry userRefColumns).
 */
export const ORG_MEMBERSHIP_SCOPED_TABLES: ReadonlySet<string> = new Set([
  "alert_sends",
]);

/**
 * Email-keyed (Category E `exportByEmailOnly`) tables that DO carry an
 * `organization_id` column and so are scoped by org rather than by the
 * member-email UNION (Decision N4).
 */
const ORG_SCOPED_EMAIL_KEYED_TABLES: ReadonlySet<string> = new Set([
  "intelligence_brief_subscribers",
]);

/** Double-quote a SQL identifier. Inputs are schema-derived. */
function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function userRefColumnsOrThrow(table: string): readonly string[] {
  const cols = TABLE_CLASSIFICATION[table]?.userRefColumns;
  if (!cols || cols.length === 0) {
    throw new Error(
      `orgQueries: table "${table}" is membership-scoped but declares no userRefColumns. ` +
        `Fix dataClassification.ts or move it to ORG_EXPORT_DEFERRED_TABLES.`,
    );
  }
  return cols;
}

/** The org-boundary WHERE body (no `WHERE` keyword) + ordered values for a dump table. */
function orgScopePredicate(table: string, orgId: string): { text: string; values: unknown[] } {
  if (table === ORGANIZATIONS_TABLE) {
    return { text: "id = $1", values: [orgId] };
  }
  if (ORG_MEMBERSHIP_SCOPED_TABLES.has(table)) {
    const refs = userRefColumnsOrThrow(table);
    const parts = refs.map(
      (c) => `${quoteIdent(c)} IN (SELECT id FROM ${USERS_TABLE} WHERE organization_id = $1)`,
    );
    return { text: parts.join(" OR "), values: [orgId] };
  }
  // The norm: the table carries organization_id (asserted by the drift test).
  return { text: "organization_id = $1", values: [orgId] };
}

/**
 * Every Category-A/B/C/D table's full-dump query for an org (minus the
 * whole-table export exclusions and the deferred tables). No actor predicate
 * (Q2). `tableColumns` must carry the live column list for every table in
 * `tablesRequiringProjection()` or building those throws fail-closed.
 */
export function buildOrgDumpQueries(orgId: string, tableColumns?: TableColumns): ExportQuery[] {
  return Object.entries(TABLE_CLASSIFICATION)
    .filter(([table, c]) => ORG_DUMP_CATEGORIES.has(c.category)
      && !EXPORT_EXCLUDED_TABLES.has(table)
      && !ORG_EXPORT_DEFERRED_TABLES.has(table))
    .map(([table, c]) => {
      const { text, values } = orgScopePredicate(table, orgId);
      return {
        table,
        category: c.category,
        text: `SELECT ${buildProjection(table, tableColumns)} FROM ${table} WHERE ${text}`,
        values,
      };
    });
}

/**
 * The email-keyed (Category E `exportByEmailOnly`) tables for an org export
 * (Decision N4): org-column tables by `organization_id`, platform-level tables
 * by the UNION of current member emails.
 */
export function buildOrgEmailKeyedQueries(
  orgId: string,
  memberEmails: readonly string[],
  tableColumns?: TableColumns,
): ExportQuery[] {
  return Object.entries(TABLE_CLASSIFICATION)
    .filter(([, c]) => c.exportByEmailOnly === true)
    .map(([table, c]) => {
      const projection = buildProjection(table, tableColumns);
      if (ORG_SCOPED_EMAIL_KEYED_TABLES.has(table)) {
        return {
          table,
          category: c.category,
          text: `SELECT ${projection} FROM ${table} WHERE organization_id = $1`,
          values: [orgId],
        };
      }
      const column = EMAIL_KEYED_COLUMNS[table];
      if (!column) {
        throw new Error(
          `orgQueries: exportByEmailOnly table "${table}" has no email column mapped in EMAIL_KEYED_COLUMNS.`,
        );
      }
      return {
        table,
        category: c.category,
        text: `SELECT ${projection} FROM ${table} WHERE ${column} = ANY($1)`,
        values: [[...memberEmails]],
      };
    });
}

/**
 * All reads that make up a full-organization export (Decision Q2): the
 * A/B/C/D full-table dump followed by the email-keyed tables. Order is stable
 * (classification order, then email-keyed) so the bundle and manifest are
 * deterministic. Parallel to `buildSelfExportQueries`.
 *
 * `memberEmails` MUST be the CURRENT emails of the org's members, read from
 * `users.email` (never client input) — they are matched directly against the
 * platform-level email-keyed tables (same trust-model invariant as the
 * self-export's `userEmail`).
 */
export function buildOrgExportQueries(
  orgId: string,
  memberEmails: readonly string[],
  tableColumns?: TableColumns,
): ExportQuery[] {
  return [
    ...buildOrgDumpQueries(orgId, tableColumns),
    ...buildOrgEmailKeyedQueries(orgId, memberEmails, tableColumns),
  ];
}
