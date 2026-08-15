/**
 * migrationRunner.test.ts — the migration transaction body and its timeouts.
 *
 * The behaviour under test is a deploy-safety control (BL-1): a migration that
 * cannot get its lock must abort fast instead of stalling every reader queued
 * behind it. These are the DB-free assertions; the real-Postgres proof that the
 * timeout actually fires lives in test/isolation/migrationRunnerTimeouts.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  applyMigration,
  DEFAULT_LOCK_TIMEOUT,
  DEFAULT_STATEMENT_TIMEOUT,
  describeMigrationFailure,
  LOCK_NOT_AVAILABLE,
  QUERY_CANCELED,
  resolveMigrationTimeouts,
  validateDuration,
  type MigrationQueryClient,
} from "../migrationRunner.js";

function recordingClient(failOn?: string): {
  client: MigrationQueryClient;
  statements: string[];
} {
  const statements: string[] = [];

  const client: MigrationQueryClient = {
    async query(sql: string) {
      statements.push(sql);

      if (failOn && sql.includes(failOn)) {
        const err = new Error("boom") as Error & { code?: string };
        err.code = LOCK_NOT_AVAILABLE;
        throw err;
      }

      return { rows: [] };
    },
  };

  return { client, statements };
}

const TIMEOUTS = { lockTimeout: "5s", statementTimeout: "300s" };

describe("resolveMigrationTimeouts", () => {
  it("defaults to a bounded lock wait rather than an unbounded one", () => {
    const resolved = resolveMigrationTimeouts({});

    expect(resolved.lockTimeout).toBe(DEFAULT_LOCK_TIMEOUT);
    expect(resolved.statementTimeout).toBe(DEFAULT_STATEMENT_TIMEOUT);
    // The whole point: absent configuration must not mean "wait forever".
    expect(resolved.lockTimeout).not.toBe("0");
  });

  it("honours operator overrides", () => {
    const resolved = resolveMigrationTimeouts({
      MIGRATION_LOCK_TIMEOUT: "2s",
      MIGRATION_STATEMENT_TIMEOUT: "45min",
    });

    expect(resolved).toEqual({ lockTimeout: "2s", statementTimeout: "45min" });
  });

  it("allows 0 to disable a timeout, but only spelled explicitly", () => {
    expect(
      resolveMigrationTimeouts({ MIGRATION_LOCK_TIMEOUT: "0" }).lockTimeout
    ).toBe("0");
  });
});

describe("validateDuration", () => {
  it.each(["5s", "500ms", "2min", "1h", "0", "  10s  "])(
    "accepts %s",
    (value) => {
      expect(() => validateDuration(value, "X")).not.toThrow();
    }
  );

  // These values are interpolated into SET LOCAL — Postgres takes no bind
  // parameter there — so validation is the injection boundary, not cosmetics.
  it.each([
    "5s'; DROP TABLE schema_migrations; --",
    "5 s",
    "abc",
    "",
    "-1s",
    "5seconds",
  ])("rejects %j", (value) => {
    expect(() => validateDuration(value, "MIGRATION_LOCK_TIMEOUT")).toThrow(
      /not a valid Postgres duration/
    );
  });

  it("names the offending variable so a bad deploy is self-diagnosing", () => {
    expect(() => validateDuration("nope", "MIGRATION_STATEMENT_TIMEOUT")).toThrow(
      /MIGRATION_STATEMENT_TIMEOUT/
    );
  });
});

describe("applyMigration", () => {
  it("sets both timeouts inside the transaction, before the migration SQL", async () => {
    const { client, statements } = recordingClient();

    await applyMigration(client, "20260101_x.sql", "ALTER TABLE t ADD c int", TIMEOUTS);

    // Ordering is the correctness property: SET LOCAL before BEGIN is a no-op
    // that warns, and after the DDL it is too late to bound the first lock.
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(statements[2]).toBe("SET LOCAL statement_timeout = '300s'");
    expect(statements[3]).toBe("ALTER TABLE t ADD c int");
    expect(statements[4]).toContain("INSERT INTO schema_migrations");
    expect(statements[5]).toBe("COMMIT");
  });

  it("uses SET LOCAL so a pooled connection never inherits the settings", async () => {
    const { client, statements } = recordingClient();

    await applyMigration(client, "20260101_x.sql", "SELECT 1", TIMEOUTS);

    const sets = statements.filter((s) => s.includes("timeout"));
    expect(sets).toHaveLength(2);
    for (const s of sets) expect(s.startsWith("SET LOCAL ")).toBe(true);
  });

  it("rolls back and rethrows when the lock cannot be acquired", async () => {
    const { client, statements } = recordingClient("ALTER TABLE");

    await expect(
      applyMigration(client, "20260101_x.sql", "ALTER TABLE t ADD c int", TIMEOUTS)
    ).rejects.toMatchObject({ code: LOCK_NOT_AVAILABLE });

    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    // Never recorded as applied — the INSERT shares the aborted transaction.
    expect(statements.some((s) => s.includes("INSERT INTO schema_migrations"))).toBe(
      false
    );
  });
});

describe("describeMigrationFailure", () => {
  it("tells the operator a lock timeout is a retry, not a broken migration", () => {
    const msg = describeMigrationFailure(
      "20260925_x.sql",
      Object.assign(new Error("x"), { code: LOCK_NOT_AVAILABLE }),
      TIMEOUTS
    );

    expect(msg).toContain("could not acquire its lock within 5s");
    expect(msg).toContain("RETRY");
    expect(msg).toContain("rolled back");
  });

  it("warns against blindly raising a statement timeout", () => {
    const msg = describeMigrationFailure(
      "20260926_x.sql",
      Object.assign(new Error("x"), { code: QUERY_CANCELED }),
      TIMEOUTS
    );

    expect(msg).toContain("300s");
    expect(msg).toContain("Do NOT simply raise the timeout");
  });

  it("falls back to a plain message for unrelated failures", () => {
    expect(describeMigrationFailure("a.sql", new Error("syntax"), TIMEOUTS)).toBe(
      "Migration failed: a.sql"
    );
  });
});
