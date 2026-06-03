/**
 * risksReviewPostCommitThrow.test.ts — A04-G1 PR γ.1 §4.3 pinning test.
 *
 * The single highest-value new test in γ.1. POST /risks/:id/review is the one
 * risks route that issues an ambient `pg.query` AFTER its explicit COMMIT but
 * BEFORE the response — the post-commit refresh SELECT (risks.ts:1186,
 * `SELECT ${RISK_SELECT} FROM risks WHERE id=$1 AND organization_id=$2`).
 *
 * What the wrap does to this path (empirically verified, §3.3 corrected)
 * --------------------------------------------------------------------
 * Under asTenant the success path is, on one tenant connection:
 *   outer BEGIN → inner SAVEPOINT sp_1 → UPDATE → inner COMMIT (RELEASE sp_1,
 *   folds the UPDATE into the outer tx) → [post-commit refresh SELECT] → res 200.
 * If the refresh throws a REAL PG error, ctx.client's transaction enters
 * Postgres's aborted state (25P02). The handler catches, runs a bare ROLLBACK
 * (savepoint stack already empty → the γ.0 mismatched-pop guard makes it a
 * no-op, correctly keeping it off the outer tx), sends 500, and resolves.
 * withTenant then runs COMMIT on the aborted tx; Postgres SILENTLY turns
 * COMMIT-on-aborted into ROLLBACK and returns the ROLLBACK tag WITHOUT error.
 * → The review UPDATE is ATOMICALLY ROLLED BACK. The client gets a 500 and no
 *   row was written, so a retry is safe (no duplicate review, no phantom row).
 *
 * This is a BEHAVIOR CHANGE versus today's unwrapped path (today the inner
 * COMMIT was durable on a dedicated connection before the refresh ran, so a
 * refresh error left the write persisted — the "500 despite persisted write"
 * quirk). The wrap FIXES that quirk structurally. This test PINS the atomic
 * behavior so any future change that re-introduces the persist-despite-500
 * quirk (e.g. moving the refresh pre-COMMIT or onto a separate connection) is a
 * conscious, reviewed change.
 *
 * Two failure modes (the test pins the QUERY-ERROR mode):
 *   - query error (this test: a missing column → 42703): the aborted-tx COMMIT
 *     becomes a no-error ROLLBACK, so COMMIT does NOT throw → NO
 *     `tenant_commit_failed` fires; the only error logged is the handler's own
 *     `risk_review_failed`.
 *   - connection death (not exercised here): COMMIT itself throws → asTenant
 *     DOES fire `tenant_commit_failed` (a durability incident). The write is
 *     lost (atomically) in BOTH modes; only the operator-visible signal differs.
 *
 * Fault injection: drop a RISK_SELECT-only column (`treatment`) so the refresh
 * errors at the PG level while the ownership SELECT and the UPDATE — which do
 * NOT reference it — succeed. DDL commits on its own connection before the
 * request, so there is no lock conflict with the request's row lock. No
 * DATABASE_URL role-sim is needed — risks has no RLS policy and this is a
 * transaction-shape test (owner connection is fine).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedRisk, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool;
let loggerModule: typeof import("../../src/api/infra/logger.js");
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the post-commit-throw test.");
  ownerPool = new Pool({ connectionString: url, ssl: false });

  originalDatabaseUrl = process.env.DATABASE_URL;
  originalMigrationUrl = process.env.MIGRATION_DATABASE_URL;
  process.env.DATABASE_URL = url;
  process.env.MIGRATION_DATABASE_URL = url;

  loggerModule = await import("../../src/api/infra/logger.js");
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await ownerPool?.end();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
  else process.env.MIGRATION_DATABASE_URL = originalMigrationUrl;
});

describe("A04-G1 PR γ.1 §4.3 — review post-COMMIT refresh failure is ATOMIC (query-error mode)", () => {
  it("500, write atomically rolled back (NOT persisted), and tenant_commit_failed does NOT fire", async () => {
    const riskId = await seedRisk(ownerPool, seed.orgA.id, { title: "post-commit-throw target" });

    const errorSpy = vi.spyOn(loggerModule.logger, "error");
    // Make the refresh SELECT error at the PG level (column it selects no longer
    // exists) while the ownership SELECT + UPDATE — which don't reference it —
    // still succeed. Restored in `finally`.
    await ownerPool.query("ALTER TABLE risks DROP COLUMN treatment");
    try {
      const res = await request(app)
        .post(`/api/risks/${riskId}/review`)
        .set("X-Api-Key", seed.orgA.apiKey)
        .send({ reviewed_at: "2026-06-01" });

      // (a) 500 risk_review_failed
      expect(res.status).toBe(500);
      expect(res.body?.error).toBe("risk_review_failed");

      // (b) the review row was atomically ROLLED BACK — last_reviewed_at stays
      // NULL. (Pre-γ.1 this would have been the 2026-06-01 date: "persist despite
      // 500". The wrap makes the request atomic; this is the headline assertion.)
      const row = await ownerPool.query<{ last_reviewed_at: string | null }>(
        "SELECT last_reviewed_at FROM risks WHERE id = $1",
        [riskId],
      );
      expect(
        row.rows[0]?.last_reviewed_at,
        "expected the review UPDATE to be rolled back (atomic-on-error); a non-null " +
          "value means the persist-despite-500 quirk has returned",
      ).toBeNull();

      // (c) query-error mode: the aborted-tx COMMIT became a no-error ROLLBACK,
      // so asTenant took NEITHER error branch — only the handler's own error log
      // fired. (A connection-death failure would instead fire tenant_commit_failed.)
      const events = errorSpy.mock.calls.map(
        (c) => (c[0] as { event?: string } | undefined)?.event,
      );
      expect(events).toContain("risk_review_failed");
      expect(events).not.toContain("tenant_commit_failed");
      expect(events).not.toContain("tenant_wrap_handler_failed");
    } finally {
      await ownerPool.query("ALTER TABLE risks ADD COLUMN treatment TEXT");
    }
  });
});
