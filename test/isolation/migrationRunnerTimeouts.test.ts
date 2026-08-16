/**
 * migrationRunnerTimeouts.test.ts — the BL-1 deploy-safety control, proven
 * against real Postgres rather than a fake client.
 *
 * BL-1 measured the danger: a long read in flight on a table, then an ALTER,
 * then an ordinary SELECT — the SELECT blocked 7,989 ms behind a 203 ms ALTER,
 * because the runner set no lock_timeout and the wait to ACQUIRE the lock is
 * unbounded. This file proves the fix does what the measurement predicted:
 *
 *   1. under contention the migration aborts at ~lock_timeout with SQLSTATE
 *      55P03, instead of waiting indefinitely;
 *   2. it is not recorded in schema_migrations, so a retry re-runs it;
 *   3. a reader arriving after the aborted migration is NOT stalled;
 *   4. uncontended migrations are unaffected;
 *   5. statement_timeout bounds a runaway migration.
 *
 * Deliberately DB-real: the whole control is Postgres lock behaviour, which a
 * mock cannot exhibit. This file does not use bootstrapTestDb — it needs a bare
 * connection and its own throwaway table, not the seeded application.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  applyMigration,
  LOCK_NOT_AVAILABLE,
  QUERY_CANCELED,
} from "../../src/api/lib/migrationRunner.js";

const TABLE = "migration_timeout_probe";

let pool: Pool;

beforeAll(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required");

  pool = new Pool({ connectionString, ssl: false, max: 6 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await pool.query(`CREATE TABLE ${TABLE} (id int)`);
  await pool.query(`INSERT INTO ${TABLE} (id) VALUES (1)`);
});

afterAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await pool.query(`DELETE FROM schema_migrations WHERE filename LIKE 'probe_%'`);
  await pool.end();
});

/**
 * Hold ACCESS SHARE on the probe table in an open transaction. ACCESS SHARE
 * conflicts with ACCESS EXCLUSIVE, so any ALTER must queue behind it — the
 * exact shape of the production hazard.
 */
async function holdConflictingLock() {
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query(`SELECT * FROM ${TABLE}`);

  return async () => {
    await blocker.query("ROLLBACK");
    blocker.release();
  };
}

describe("migration lock_timeout under contention", () => {
  it("aborts at ~lock_timeout with 55P03 instead of waiting unbounded", async () => {
    const release = await holdConflictingLock();
    const client = await pool.connect();

    try {
      const started = Date.now();

      const failure = await applyMigration(
        client,
        "probe_contended.sql",
        `ALTER TABLE ${TABLE} ADD COLUMN added_a int`,
        { lockTimeout: "1s", statementTimeout: "60s" }
      ).catch((err: unknown) => err);

      const elapsed = Date.now() - started;

      expect(failure).toMatchObject({ code: LOCK_NOT_AVAILABLE });
      // Bounded by the timeout, not by the blocker's lifetime.
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      client.release();
      await release();
    }
  });

  it("does not record the aborted migration, so a retry re-runs it", async () => {
    const recorded = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      ["probe_contended.sql"]
    );

    expect(recorded.rowCount).toBe(0);

    const column = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = 'added_a'`,
      [TABLE]
    );

    expect(column.rowCount).toBe(0);
  });

  it("leaves a later reader unstalled — the outage this prevents", async () => {
    const release = await holdConflictingLock();
    const migrating = await pool.connect();

    try {
      await applyMigration(
        migrating,
        "probe_reader.sql",
        `ALTER TABLE ${TABLE} ADD COLUMN added_b int`,
        { lockTimeout: "1s", statementTimeout: "60s" }
      ).catch(() => undefined);

      // The reader arrives after the DDL gave up. With no lock_timeout it would
      // still be queued behind the ALTER, which is queued behind the blocker.
      const started = Date.now();
      await pool.query(`SELECT count(*) FROM ${TABLE}`);
      const elapsed = Date.now() - started;

      expect(elapsed).toBeLessThan(1_000);
    } finally {
      migrating.release();
      await release();
    }
  });
});

describe("uncontended migrations are unaffected", () => {
  it("applies the DDL and records it", async () => {
    const client = await pool.connect();

    try {
      await applyMigration(
        client,
        "probe_clean.sql",
        `ALTER TABLE ${TABLE} ADD COLUMN added_c int`,
        { lockTimeout: "5s", statementTimeout: "60s" }
      );
    } finally {
      client.release();
    }

    const column = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = 'added_c'`,
      [TABLE]
    );
    expect(column.rowCount).toBe(1);

    const recorded = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      ["probe_clean.sql"]
    );
    expect(recorded.rowCount).toBe(1);
  });

  it("does not leak the timeouts onto the pooled connection", async () => {
    const client = await pool.connect();

    try {
      await applyMigration(client, "probe_leak.sql", "SELECT 1", {
        lockTimeout: "1s",
        statementTimeout: "2s",
      });

      // SET LOCAL is discarded at COMMIT; a session-level SET would persist and
      // silently cap every later query on this connection.
      const after = await client.query("SHOW statement_timeout");
      expect((after.rows[0] as { statement_timeout: string }).statement_timeout).not.toBe(
        "2s"
      );
    } finally {
      client.release();
    }
  });
});

describe("statement_timeout bounds a runaway migration", () => {
  it("cancels with 57014 and rolls back", async () => {
    const client = await pool.connect();

    try {
      const failure = await applyMigration(
        client,
        "probe_runaway.sql",
        "SELECT pg_sleep(5)",
        { lockTimeout: "5s", statementTimeout: "500ms" }
      ).catch((err: unknown) => err);

      expect(failure).toMatchObject({ code: QUERY_CANCELED });
    } finally {
      client.release();
    }

    const recorded = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      ["probe_runaway.sql"]
    );
    expect(recorded.rowCount).toBe(0);
  });
});
