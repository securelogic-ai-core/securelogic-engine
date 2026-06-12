/**
 * dataClassification.test.ts — static drift guards for the GDPR data-rights
 * classification constants (src/api/lib/dataClassification.ts).
 *
 * No database access. These tests parse db/migrations/ at read time and assert
 * the runtime constants stay complete against the live schema, so a future
 * migration that adds a table or a users column can't silently bypass the
 * classification / tombstone logic.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import {
  TABLE_CLASSIFICATION,
  TOMBSTONE_USER_PATCH,
  TOMBSTONE_PRESERVED_COLUMNS,
} from "../lib/dataClassification";
import {
  buildSelfExportQueries,
  buildOrgExportQueries,
  EXPORT_EXCLUDED_TABLES,
  tablesRequiringProjection,
  ORG_EXPORT_DEFERRED_TABLES,
  ORG_MEMBERSHIP_SCOPED_TABLES,
} from "../services/dataExport/index";

const MIGRATIONS_DIR = resolve(__dirname, "../../../db/migrations");

/** Strip `--` line comments so commented-out SQL never registers as real DDL. */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

function allMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return files.map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8")).join("\n");
}

/** Every table created by a migration (CREATE TABLE [IF NOT EXISTS] <name>). */
function migrationTableNames(): Set<string> {
  const sql = stripSqlComments(allMigrationSql());
  const re = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) names.add(m[1].toLowerCase());
  return names;
}

/**
 * Parse the users table column set + NOT NULL flag from migrations:
 *   - the CREATE TABLE users (...) block in 001, plus
 *   - every ALTER TABLE users ADD COLUMN [IF NOT EXISTS] across all migrations.
 * Returns column name → isNotNull (OR-ed across all occurrences).
 */
function usersColumns(): Map<string, boolean> {
  const sql = stripSqlComments(allMigrationSql());
  const cols = new Map<string, boolean>();
  const setCol = (name: string, notNull: boolean) =>
    cols.set(name, (cols.get(name) ?? false) || notNull);

  // 1. CREATE TABLE users ( ... );  — take the block up to the first ");".
  const block = /CREATE TABLE users\s*\(([\s\S]*?)\);/i.exec(sql);
  if (block) {
    for (const raw of block[1].split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      // Skip table-level constraint lines, not columns.
      if (/^(UNIQUE|PRIMARY|CONSTRAINT|CHECK|FOREIGN)\b/i.test(line)) continue;
      const col = /^([a-z_][a-z0-9_]*)\s/i.exec(line);
      if (!col) continue;
      setCol(col[1].toLowerCase(), /NOT NULL/i.test(line));
    }
  }

  // 2. ALTER TABLE users ADD COLUMN [IF NOT EXISTS] <col> <rest up to , or ;>.
  const addRe =
    /ALTER TABLE users\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s+([^,;]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = addRe.exec(sql)) !== null) {
    setCol(m[1].toLowerCase(), /NOT NULL/i.test(m[2]));
  }

  return cols;
}

/**
 * Generic column-name parser for any table: the CREATE TABLE [IF NOT EXISTS]
 * <table> (...) block plus every ALTER TABLE <table> ADD COLUMN. Used to assert
 * exportExcludedColumns reference columns that actually exist.
 */
function migrationColumnsFor(table: string): Set<string> {
  const sql = stripSqlComments(allMigrationSql());
  const cols = new Set<string>();

  const blockRe = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(([\\s\\S]*?)\\);`,
    "i",
  );
  const block = blockRe.exec(sql);
  if (block) {
    for (const raw of block[1].split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (/^(UNIQUE|PRIMARY|CONSTRAINT|CHECK|FOREIGN)\b/i.test(line)) continue;
      const col = /^([a-z_][a-z0-9_]*)\s/i.exec(line);
      if (col) cols.add(col[1].toLowerCase());
    }
  }

  // A single `ALTER TABLE <table> ... ;` may carry MANY comma-separated
  // `ADD COLUMN` clauses, so scan each whole statement body for every clause.
  const stmtRe = new RegExp(`ALTER TABLE ${table}\\b([\\s\\S]*?);`, "gi");
  const addRe = /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi;
  let stmt: RegExpExecArray | null;
  while ((stmt = stmtRe.exec(sql)) !== null) {
    addRe.lastIndex = 0;
    let add: RegExpExecArray | null;
    while ((add = addRe.exec(stmt[1])) !== null) cols.add(add[1].toLowerCase());
  }

  return cols;
}

// Columns we treat as personal-identifier PII that MUST be addressed on
// tombstone (scrubbed or explicitly preserved).
const PII_USER_COLUMNS = ["email", "name"];

describe("TABLE_CLASSIFICATION completeness", () => {
  it("classifies every table created by a migration", () => {
    const tables = migrationTableNames();
    const missing = [...tables].filter((t) => !(t in TABLE_CLASSIFICATION)).sort();
    expect(missing).toEqual([]);
  });

  it("includes the two tables this PR introduces", () => {
    expect(TABLE_CLASSIFICATION.jobs?.category).toBe("E");
    expect(TABLE_CLASSIFICATION.data_export_files?.category).toBe("E");
    expect(TABLE_CLASSIFICATION.jobs?.rlsStatus).toBe("enabled");
    expect(TABLE_CLASSIFICATION.data_export_files?.rlsStatus).toBe("enabled");
  });

  it("every entry has a valid category, piiRisk, and rlsStatus", () => {
    for (const [table, c] of Object.entries(TABLE_CLASSIFICATION)) {
      expect(["A", "B", "C", "D", "E", "F"], table).toContain(c.category);
      expect(["high", "medium", "low", "none"], table).toContain(c.piiRisk);
      expect(["enabled", "pending", "none"], table).toContain(c.rlsStatus);
    }
  });
});

describe("export query-builder coverage (PR #2a)", () => {
  // The self-export builders must cover every table the classification says holds
  // exportable user data, so a future migration that adds such a table can't
  // silently escape the export. Mirror of the categoryQueries matching rules.
  const subject = {
    userId: "00000000-0000-0000-0000-000000000000",
    userEmail: "drift@example.com",
    orgId: "00000000-0000-0000-0000-0000000000ff",
  };
  // Tables with exportExcludedColumns require a live column list, else the
  // builder throws fail-closed. Build the stub from the actual migration schema.
  const exportColumnStub: Record<string, string[]> = {};
  for (const t of tablesRequiringProjection()) {
    exportColumnStub[t] = [...migrationColumnsFor(t)];
  }

  // Probe both branches so dependency_assessments is covered regardless of the
  // reviewer_uuid presence flag.
  const coveredTables = new Set([
    ...buildSelfExportQueries(subject, {}, exportColumnStub).map((q) => q.table),
    ...buildSelfExportQueries(
      subject,
      { dependencyAssessmentsReviewerUuidPresent: false },
      exportColumnStub,
    ).map((q) => q.table),
  ]);

  it("has a query builder for every Category-B and Category-C table (minus exclusions)", () => {
    const expected = Object.entries(TABLE_CLASSIFICATION)
      .filter(
        ([table, c]) =>
          (c.category === "B" || c.category === "C") && !EXPORT_EXCLUDED_TABLES.has(table),
      )
      .map(([table]) => table);

    const missing = expected.filter((t) => !coveredTables.has(t)).sort();
    expect(missing).toEqual([]);
  });

  it("has a query builder for every exportByEmailOnly table", () => {
    const expected = Object.entries(TABLE_CLASSIFICATION)
      .filter(([, c]) => c.exportByEmailOnly === true)
      .map(([table]) => table);

    expect(expected.length).toBeGreaterThan(0); // guard against the filter going stale
    const missing = expected.filter((t) => !coveredTables.has(t)).sort();
    expect(missing).toEqual([]);
  });

  it("never emits an excluded table (password_history)", () => {
    expect(coveredTables.has("password_history")).toBe(false);
    for (const t of EXPORT_EXCLUDED_TABLES) expect(coveredTables.has(t)).toBe(false);
  });

  it("exportByEmailOnly is only set on Category-E tables", () => {
    for (const [table, c] of Object.entries(TABLE_CLASSIFICATION)) {
      if (c.exportByEmailOnly) {
        expect(c.category, table).toBe("E");
      }
    }
  });

  it("every exportExcludedColumns entry references a column that exists in the schema", () => {
    const problems: string[] = [];
    for (const [table, c] of Object.entries(TABLE_CLASSIFICATION)) {
      if (!c.exportExcludedColumns?.length) continue;
      const actual = migrationColumnsFor(table);
      // Sanity: the parser found the table at all.
      expect(actual.size, `parser found no columns for ${table}`).toBeGreaterThan(0);
      for (const col of c.exportExcludedColumns) {
        if (!actual.has(col.toLowerCase())) problems.push(`${table}.${col}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("guards that the known secret-bearing tables carry exclusions", () => {
    // If these regress to no exclusions, the projection silently becomes SELECT *.
    expect(TABLE_CLASSIFICATION.users?.exportExcludedColumns).toContain("password_hash");
    expect(TABLE_CLASSIFICATION.users?.exportExcludedColumns).toContain("totp_secret");
    expect(TABLE_CLASSIFICATION.org_invites?.exportExcludedColumns).toContain("token");
    // PR #2b / Q5 org_full additions.
    expect(TABLE_CLASSIFICATION.organizations?.exportExcludedColumns).toContain("stripe_customer_id");
    expect(TABLE_CLASSIFICATION.organizations?.exportExcludedColumns).toContain("promo_code");
    expect(TABLE_CLASSIFICATION.webhook_endpoints?.exportExcludedColumns).toContain("secret");
    // entitlement_level (the portable plan tier) must NOT be excluded (N3).
    expect(TABLE_CLASSIFICATION.organizations?.exportExcludedColumns).not.toContain("entitlement_level");
  });
});

describe("org export builder coverage (PR #2b — Decision Q2)", () => {
  const ORG_CATEGORIES = new Set(["A", "B", "C", "D"]);

  // Projection-table column stub from the live schema (same approach the
  // self-export coverage uses for tablesRequiringProjection()).
  const orgColumnStub: Record<string, string[]> = {};
  for (const t of tablesRequiringProjection()) {
    orgColumnStub[t] = [...migrationColumnsFor(t)];
  }
  const orgCovered = new Set(
    buildOrgExportQueries("00000000-0000-0000-0000-0000000000aa", [], orgColumnStub).map((q) => q.table),
  );

  function abcdTables(): string[] {
    return Object.entries(TABLE_CLASSIFICATION)
      .filter(([table, c]) => ORG_CATEGORIES.has(c.category) && !EXPORT_EXCLUDED_TABLES.has(table))
      .map(([table]) => table);
  }

  it("covers every A/B/C/D table except the explicitly deferred ones", () => {
    const expected = abcdTables().filter((t) => !ORG_EXPORT_DEFERRED_TABLES.has(t));
    const missing = expected.filter((t) => !orgCovered.has(t)).sort();
    expect(missing).toEqual([]);
  });

  it("emits no excluded, deferred, E, or F table", () => {
    for (const t of EXPORT_EXCLUDED_TABLES) expect(orgCovered.has(t)).toBe(false);
    for (const t of ORG_EXPORT_DEFERRED_TABLES) expect(orgCovered.has(t)).toBe(false);
    // A Category-F table (billing) and a non-email-keyed Category-E table.
    expect(orgCovered.has("api_keys")).toBe(false);
    expect(orgCovered.has("signals")).toBe(false);
  });

  it("the deferral + membership sets equal exactly the no-organization_id A/B/C/D tables", () => {
    // Every A/B/C/D table that the dump scopes by `organization_id` MUST actually
    // have that column. The only tables allowed NOT to are `organizations`
    // (scoped by id), the membership-scoped set, and the deferred set. If a
    // migration adds/removes organization_id, this fails and forces an update.
    const noOrgColumn = abcdTables().filter(
      (t) => t !== "organizations" && !migrationColumnsFor(t).has("organization_id"),
    );
    const unhandled = noOrgColumn
      .filter((t) => !ORG_MEMBERSHIP_SCOPED_TABLES.has(t) && !ORG_EXPORT_DEFERRED_TABLES.has(t))
      .sort();
    expect(unhandled).toEqual([]);

    // No stale entries: the static sets must not list tables that DO have
    // organization_id (which would mean they should be scoped normally now).
    for (const t of ORG_MEMBERSHIP_SCOPED_TABLES) {
      expect(migrationColumnsFor(t).has("organization_id"), `${t} now has organization_id`).toBe(false);
    }
    for (const t of ORG_EXPORT_DEFERRED_TABLES) {
      expect(migrationColumnsFor(t).has("organization_id"), `${t} now has organization_id`).toBe(false);
    }
  });

  it("membership-scoped tables declare the userRefColumns their subquery needs", () => {
    for (const t of ORG_MEMBERSHIP_SCOPED_TABLES) {
      const refs = TABLE_CLASSIFICATION[t]?.userRefColumns ?? [];
      expect(refs.length, `${t} needs userRefColumns`).toBeGreaterThan(0);
      const cols = migrationColumnsFor(t);
      for (const ref of refs) expect(cols.has(ref), `${t}.${ref} missing`).toBe(true);
    }
  });

  it("scopes the organizations row by its own id column", () => {
    expect(migrationColumnsFor("organizations").has("id")).toBe(true);
  });
});

describe("TOMBSTONE_USER_PATCH coverage", () => {
  const patchKeys = new Set(Object.keys(TOMBSTONE_USER_PATCH));
  const preserved = new Set(TOMBSTONE_PRESERVED_COLUMNS);

  it("every NOT NULL or PII users column is scrubbed or explicitly preserved", () => {
    const cols = usersColumns();
    // Sanity: the parser actually found the users table.
    expect(cols.size).toBeGreaterThan(10);

    const required = [...cols.entries()]
      .filter(([name, notNull]) => notNull || PII_USER_COLUMNS.includes(name))
      .map(([name]) => name);

    const unhandled = required
      .filter((name) => !patchKeys.has(name) && !preserved.has(name))
      .sort();

    expect(unhandled).toEqual([]);
  });

  it("the PII identifier columns are actually scrubbed (not merely preserved)", () => {
    for (const col of PII_USER_COLUMNS) {
      expect(patchKeys.has(col), `${col} must be in the scrub patch`).toBe(true);
    }
  });

  it("patch and preserved sets do not overlap", () => {
    const overlap = [...patchKeys].filter((k) => preserved.has(k)).sort();
    expect(overlap).toEqual([]);
  });

  it("preserves the user UUID and org linkage (tombstone invariant)", () => {
    expect(preserved.has("id")).toBe(true);
    expect(preserved.has("organization_id")).toBe(true);
    // id/organization_id must never be in the scrub patch.
    expect(patchKeys.has("id")).toBe(false);
    expect(patchKeys.has("organization_id")).toBe(false);
  });

  it("sets the terminal lifecycle state and a deletion timestamp", () => {
    expect(TOMBSTONE_USER_PATCH.status).toBe("deleted");
    expect(TOMBSTONE_USER_PATCH.deleted_at).toBe("{now}");
  });
});

describe("TOMBSTONE_USER_PATCH snapshot", () => {
  it("matches the reviewed shape (accidental changes must be reviewed)", () => {
    expect(TOMBSTONE_USER_PATCH).toMatchInlineSnapshot(`
      {
        "deleted_at": "{now}",
        "dismissed_banner_keys": [],
        "email": "deleted-{id}@deleted.invalid",
        "email_verification_expires_at": null,
        "email_verification_token": null,
        "email_verified": false,
        "failed_login_attempts": 0,
        "last_failed_login_at": null,
        "last_login_at": null,
        "lockout_until": null,
        "name": "Deleted User",
        "password_changed_at": null,
        "password_hash": "",
        "password_reset_expires_at": null,
        "password_reset_token": null,
        "previous_login_at": null,
        "sso_provider": null,
        "status": "deleted",
        "totp_backup_codes": [],
        "totp_enabled": false,
        "totp_secret": null,
        "updated_at": "{now}",
      }
    `);
  });
});
