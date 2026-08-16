/**
 * migrationFilenameOrder.test.ts — proves the production migration set rebuilds
 * an empty database in STRICT FILENAME ORDER, with no retry and no dependency
 * resolution.
 *
 * Why this exists
 * ---------------
 * `scripts/runMigrations.ts` applies db/migrations in plain lexicographic
 * filename order, each file in its own transaction, and stops at the first
 * failure. Nothing enforced that the filenames were actually monotonic with
 * respect to their dependencies, and one file had drifted: a migration
 * committed 2026-04-17 carried the filename date 2026-05-22, so it sorted
 * AFTER the 2026-05-04 migration that ALTERs the table it creates. On an
 * empty database `npm run migrate` died at file 53 with
 * `relation "user_alert_preferences" does not exist`
 * (docs/validation/migrate-from-scratch-defect.md). Deploys were unaffected —
 * staging and prod accreted the files in commit order — so the defect was
 * invisible to every path except the ones that matter in an emergency:
 * disaster recovery by replay, new-environment provisioning, and the
 * documented developer setup.
 *
 * It stayed invisible for a second reason: test/isolation/testDb.ts, the one
 * thing that rebuilds from scratch on every CI run, has its own applier with
 * RETRY PASSES. It routed around the defect and logged a warning nobody read.
 *
 * So this file deliberately does NOT use bootstrapTestDb. It reproduces the
 * deploy: `listMigrationFilenames` for the order and `applyMigration` for the
 * transaction body, both imported from the same module scripts/runMigrations.ts
 * calls. If those two ever diverged from the deploy, this test would be green
 * about the wrong thing.
 *
 * The fix under test is a rename, NOT retry logic in the runner. The runner
 * still fails fast on the first error, which is what makes it able to detect
 * the next misordered filename instead of silently healing it.
 *
 * Isolation
 * ---------
 * Runs against its OWN scratch database on the harness server, created and
 * dropped here, so it neither sees nor disturbs the schema the rest of the
 * harness shares. `app_request` (20260618) is a CLUSTER-level role and may
 * already exist from a sibling run — that migration guards its CREATE ROLE, so
 * a fresh database on a warm cluster is still a faithful rebuild.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  applyMigration,
  ensureMigrationTable,
  listMigrationFilenames,
  migrationsDirFrom,
  resolveMigrationTimeouts,
} from "../../src/api/lib/migrationRunner.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MIGRATIONS_DIR = migrationsDirFrom(REPO_ROOT);

/**
 * The migration renamed to repair the ordering defect. It CREATEs
 * `user_alert_preferences`; 20260504_user_alert_preferences_org_scope.sql
 * ALTERs it. Named here so that if someone renames it again, this test tells
 * them which file the idempotency proof is about rather than failing obscurely.
 */
const RENAMED_MIGRATION = "20260417_alert_preferences.sql";
/** Its filename before the repair — still recorded in every existing environment. */
const LEGACY_FILENAME = "20260522_alert_preferences.sql";
/** The migration whose dependency the rename restores. */
const DEPENDENT_MIGRATION = "20260504_user_alert_preferences_org_scope.sql";

/** Tables the renamed migration owns — the surface its re-apply must not alter. */
const IDEMPOTENCY_TABLES = ["user_alert_preferences", "alert_sends"];

const SCRATCH_DB = "securelogic_migration_order_probe";

let adminPool: Pool;
let pool: Pool;

/** Files in the exact order the deploy applies them. */
let files: string[] = [];
/** Filled in by beforeAll; asserted on by the tests. */
let applied: string[] = [];
let failure: { file: string; index: number; message: string } | null = null;
let elapsedMs = 0;

/**
 * pg turns an error on an IDLE pooled client into an unhandled `error` event,
 * which vitest reports as an uncaught exception and fails the whole run — even
 * when every test passed. Teardown provokes exactly that: dropping the scratch
 * database WITH (FORCE) sends SQLSTATE 57P01 ("terminating connection due to
 * administrator command") to any connection that has not finished closing.
 * That is teardown noise about a database being deliberately destroyed, not a
 * test signal, so it is swallowed here rather than allowed to redden a green run.
 */
function swallowPoolErrors(target: Pool): void {
  target.on("error", () => {});
}

/** Swap the database name in the harness URL, keeping credentials and host. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start a throwaway Postgres with " +
        "scripts/harness-db-up.sh and export TEST_DATABASE_URL.",
    );
  }
  if (/staging|prod/i.test(url)) {
    throw new Error(
      "TEST_DATABASE_URL looks like a staging/production database — refusing " +
        "to create and drop databases on it.",
    );
  }
  return url;
}

/**
 * Snapshot the columns and indexes of the given tables. Compared before and
 * after the re-apply to prove idempotency as a property of the SCHEMA, not
 * merely as "the statement did not throw".
 */
async function snapshotSchema(target: Pool, tables: string[]) {
  const columns = await target.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, column_name`,
    [tables],
  );
  const indexes = await target.query(
    `SELECT tablename, indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY($1)
      ORDER BY tablename, indexname`,
    [tables],
  );
  const constraints = await target.query(
    `SELECT rel.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public' AND rel.relname = ANY($1)
      ORDER BY rel.relname, con.conname`,
    [tables],
  );
  return {
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
  };
}

beforeAll(async () => {
  const harnessUrl = requireTestDatabaseUrl();

  // CREATE/DROP DATABASE cannot run inside the target database, so connect to
  // the `postgres` maintenance database for them.
  adminPool = new Pool({
    connectionString: withDatabase(harnessUrl, "postgres"),
    ssl: false,
    max: 1,
  });
  swallowPoolErrors(adminPool);

  // FORCE, because a previous crashed run may have left the scratch database
  // behind with a live connection.
  await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${SCRATCH_DB}`);

  pool = new Pool({
    connectionString: withDatabase(harnessUrl, SCRATCH_DB),
    ssl: false,
    max: 4,
  });
  swallowPoolErrors(pool);

  // Same bookkeeping table and same timeouts as the deploy.
  await ensureMigrationTable(pool);
  const timeouts = resolveMigrationTimeouts();
  files = listMigrationFilenames(MIGRATIONS_DIR);

  const startedAt = process.hrtime.bigint();

  for (const [index, file] of files.entries()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await applyMigration(client, file, sql, timeouts);
      applied.push(file);
    } catch (err) {
      // Record rather than throw: a thrown hook reports "beforeAll failed" and
      // buries the filename. The assertions below name the file that broke.
      failure = { file, index, message: (err as Error).message };
      break;
    } finally {
      client.release();
    }
  }

  elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
}, 300_000);

afterAll(async () => {
  // End the pool first so the drop below has nothing to terminate. pool.end()
  // resolving does not guarantee the server has already reaped the backends,
  // hence the explicit sweep below and swallowPoolErrors above.
  await pool?.end();

  if (adminPool) {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [SCRATCH_DB],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await adminPool.end();
  }
});

describe("the production migration set rebuilds an empty database", () => {
  it("applies every migration in strict filename order, first try, no retry", () => {
    // Not a performance assertion — a line that makes the from-scratch rebuild
    // a visible fact in the run output rather than an assumption. Logged from
    // inside the test because vitest's reporter does not surface console output
    // written in beforeAll.
    // eslint-disable-next-line no-console
    console.log(
      `[migration-order] ${applied.length}/${files.length} migrations applied ` +
        `to a fresh database in strict filename order in ` +
        `${elapsedMs.toFixed(0)}ms (no retry, no deferrals)`,
    );

    if (failure) {
      throw new Error(
        `Migration ${failure.file} (file ${failure.index + 1} of ` +
          `${files.length}) failed on a FRESH database: ${failure.message}\n\n` +
          `db/migrations is applied in plain filename order with no retry, so ` +
          `a migration must sort AFTER everything it depends on. This failure ` +
          `means a filename date is out of step with its dependency — the ` +
          `deploy is fine (existing environments already applied these in ` +
          `commit order) but disaster recovery, new-environment provisioning ` +
          `and developer setup are all broken until the filename is fixed.\n` +
          `Fix by RENAMING the depended-upon migration so it sorts earlier — ` +
          `see docs/validation/migrate-from-scratch-defect.md. Do not add ` +
          `retry to scripts/runMigrations.ts: that hides the next occurrence.`,
      );
    }

    expect(applied).toEqual(files);
  });

  it("records exactly one schema_migrations row per file", async () => {
    const res = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename ASC",
    );
    expect(res.rows.map((r) => r.filename)).toEqual(files);
  });

  it("orders the alert-preferences pair so the CREATE precedes the ALTER", () => {
    // The specific inversion this test was written for. Asserted by name so a
    // future re-introduction fails with the reason, not just a SQL error.
    expect(files).toContain(RENAMED_MIGRATION);
    expect(files).not.toContain(LEGACY_FILENAME);
    expect(files.indexOf(RENAMED_MIGRATION)).toBeLessThan(
      files.indexOf(DEPENDENT_MIGRATION),
    );
  });
});

describe("the rename is safe to land on an existing environment", () => {
  /**
   * Existing environments already ran this migration under LEGACY_FILENAME.
   * The runner is filename-keyed, so on the next deploy they will apply the
   * file a second time under its new name and end up carrying both rows in
   * schema_migrations forever (the hazard BUILD_SEQUENCE.md F-1 describes).
   * That is only acceptable if the second apply is a no-op.
   *
   * This reproduces exactly that state — rewrite the scratch database's
   * bookkeeping to look like an environment that applied the old name — then
   * performs the re-apply the deploy would perform, against a database that
   * already carries every later migration's changes to these tables.
   */
  it("re-applies as a no-op over the fully migrated schema", async () => {
    await pool.query("DELETE FROM schema_migrations WHERE filename = $1", [
      RENAMED_MIGRATION,
    ]);
    await pool.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1)",
      [LEGACY_FILENAME],
    );

    const before = await snapshotSchema(pool, IDEMPOTENCY_TABLES);

    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, RENAMED_MIGRATION),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await applyMigration(
        client,
        RENAMED_MIGRATION,
        sql,
        resolveMigrationTimeouts(),
      );
    } finally {
      client.release();
    }

    const after = await snapshotSchema(pool, IDEMPOTENCY_TABLES);
    expect(after).toEqual(before);

    // Both filenames coexist; the UNIQUE(filename) constraint is not violated
    // and the legacy row is not disturbed.
    const rows = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations WHERE filename = ANY($1) ORDER BY filename",
      [[LEGACY_FILENAME, RENAMED_MIGRATION]],
    );
    expect(rows.rows.map((r) => r.filename)).toEqual([
      RENAMED_MIGRATION,
      LEGACY_FILENAME,
    ]);
  });

  it("preserves rows written before the re-apply", async () => {
    // A no-op on an empty table proves less than a no-op on a populated one:
    // a CREATE TABLE that was not actually guarded would take the data with it.
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status, entitlement_level)
       VALUES ('Migration Order Probe', 'migration-order-probe', 'active', 'premium')
       RETURNING id`,
    );
    const orgId = org.rows[0].id;
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, password_hash, role)
       VALUES ($1, 'probe@example.test', 'x', 'admin')
       RETURNING id`,
      [orgId],
    );
    const userId = user.rows[0].id;

    await pool.query(
      `INSERT INTO user_alert_preferences (user_id, organization_id)
       VALUES ($1, $2)`,
      [userId, orgId],
    );
    await pool.query(
      `INSERT INTO alert_sends (user_id, alert_type, reference_id)
       VALUES ($1, 'critical_finding', 'probe-ref')`,
      [userId],
    );

    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, RENAMED_MIGRATION),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await applyMigration(
        client,
        `${RENAMED_MIGRATION}#second-reapply`,
        sql,
        resolveMigrationTimeouts(),
      );
    } finally {
      client.release();
    }

    const prefs = await pool.query(
      "SELECT 1 FROM user_alert_preferences WHERE user_id = $1",
      [userId],
    );
    const sends = await pool.query(
      "SELECT 1 FROM alert_sends WHERE user_id = $1 AND reference_id = 'probe-ref'",
      [userId],
    );
    expect(prefs.rowCount).toBe(1);
    expect(sends.rowCount).toBe(1);
  });
});

