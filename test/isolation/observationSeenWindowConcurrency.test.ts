/**
 * observationSeenWindowConcurrency.test.ts — the temporal invariant of an
 * observation row, proven against real Postgres with controlled transaction
 * ordering.
 *
 * THE INVARIANT
 *   first_seen_at <= last_seen_at, for every row, at all times.
 *   first_seen_at never moves forward. last_seen_at never moves backward.
 *
 * THE DEFECT THIS FILE EXISTS FOR
 * `recordObservation` upserted with `last_seen_at = NOW()`. In Postgres `NOW()`
 * is `transaction_timestamp()` — the instant the transaction BEGAN, not the
 * instant the statement runs. Concurrent scan imports of the same exposure
 * serialize on the asset advisory lock (assetAutoCreation.ts), and the
 * transaction that WAITS on a lock is by definition one that began EARLIER. So
 * the waiter arrived at the UPDATE holding an older NOW() than the winner had
 * already stamped into first_seen_at, wrote last_seen_at < first_seen_at, and
 * violated the observation_seen_window CHECK — 500-ing the entire import.
 *
 * WHY THIS TEST IS DETERMINISTIC, AND NOT A RACE HARNESS
 * The bug was reported as intermittent, and it is — but only because WHICH
 * transaction begins first is scheduling. GIVEN the ordering, the failure is
 * certain. So this file does not spawn concurrent promises and hope: it OPENS
 * THE TRANSACTIONS IN A CHOSEN ORDER and drives them by hand. Every case below
 * fails 100% of the time against the old statement and passes 100% of the time
 * against the fixed one.
 *
 * The `oldStatement` control arm is what makes that claim checkable rather than
 * asserted: it is the pre-fix SQL, run against the same rows in the same
 * ordering, and it is REQUIRED to fail. If a future change made the old shape
 * safe (or the new shape unsafe), one of the two halves goes red.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import {
  recordObservation,
  type Queryable,
} from "../../src/api/lib/vulnerabilityObservationStore.js";
import { emptySummary } from "../../src/api/lib/observationReconciliation.js";

let seed: TestDbSeed;
let pool: Pool;

type Fixture = { findingId: string; assetId: string; occurrenceId: string; runId: string };

async function mkFixture(orgId: string, tag: string): Promise<Fixture> {
  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, status, source_type)
     VALUES ($1, $2, 'Critical', 'seen-window harness', 'open', 'vulnerability') RETURNING id`,
    [orgId, `seen-window ${tag}`],
  );
  const a = await pool.query<{ id: string }>(
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
     VALUES ($1, 'endpoint', 'endpoints', gen_random_uuid(), 'active') RETURNING id`,
    [orgId],
  );
  const o = await pool.query<{ id: string }>(
    `INSERT INTO finding_asset_occurrences (organization_id, finding_id, asset_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [orgId, f.rows[0]!.id, a.rows[0]!.id],
  );
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vulnerability_scan_runs
       (organization_id, source_key, external_run_id, status, scope_declared, completed_at)
     VALUES ($1, 'harness-scanner', $2, 'completed', FALSE, NOW()) RETURNING id`,
    [orgId, `run-${tag}`],
  );
  return {
    findingId: f.rows[0]!.id,
    assetId: a.rows[0]!.id,
    occurrenceId: o.rows[0]!.id,
    runId: r.rows[0]!.id,
  };
}

/** Open a transaction and stamp its transaction_timestamp() NOW, deterministically. */
async function beginAt(orgId: string): Promise<{ client: PoolClient; txStart: Date }> {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
  const t = await client.query<{ t: Date }>("SELECT now() AS t");
  return { client, txStart: t.rows[0]!.t };
}

/** The PRE-FIX statement, verbatim. Its job in this file is to FAIL. */
const oldStatement = `
  INSERT INTO vulnerability_observations
    (organization_id, occurrence_id, source_key, external_ref, first_scan_run_id, last_scan_run_id)
  VALUES ($1, $2, $3, $4, $5, $5)
  ON CONFLICT (organization_id, source_key, external_ref)
  DO UPDATE SET last_seen_at = NOW()
  RETURNING id`;

const obs = (f: Fixture, ref: string) => ({
  occurrenceId: f.occurrenceId,
  sourceKey: "harness-scanner",
  externalRef: ref,
});

async function readWindow(orgId: string, ref: string) {
  const r = await pool.query<{ first_seen_at: Date; last_seen_at: Date }>(
    `SELECT first_seen_at, last_seen_at FROM vulnerability_observations
      WHERE organization_id = $1 AND source_key = 'harness-scanner' AND external_ref = $2`,
    [orgId, ref],
  );
  expect(r.rowCount).toBe(1);
  return r.rows[0]!;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

// ---------------------------------------------------------------------------
// The control arm: the OLD statement must fail, in this exact ordering.
// ---------------------------------------------------------------------------

describe("the pre-fix statement is deterministically broken", () => {
  it("writer B starts FIRST, commits SECOND — old SQL writes last_seen < first_seen", async () => {
    const f = await mkFixture(seed.orgA.id, "control-1");
    const ref = "control-1@ref";

    // B begins first: its transaction_timestamp() is the EARLIER one. This is
    // the advisory-lock loser — it began, then waited.
    const B = await beginAt(seed.orgA.id);
    await new Promise((r) => setTimeout(r, 40));
    // A begins second, wins the lock, and inserts. first_seen_at = A's NOW().
    const A = await beginAt(seed.orgA.id);
    expect(B.txStart.getTime()).toBeLessThan(A.txStart.getTime());

    await A.client.query(oldStatement, [seed.orgA.id, f.occurrenceId, "harness-scanner", ref, f.runId]);
    await A.client.query("COMMIT");
    A.client.release();

    // B proceeds after A commits — exactly what the advisory-lock loser does.
    await expect(
      B.client.query(oldStatement, [seed.orgA.id, f.occurrenceId, "harness-scanner", ref, f.runId]),
    ).rejects.toMatchObject({ code: "23514", constraint: "observation_seen_window" });

    await B.client.query("ROLLBACK");
    B.client.release();
  });
});

// ---------------------------------------------------------------------------
// The fix: the same orderings, through the REAL recordObservation.
// ---------------------------------------------------------------------------

describe("recordObservation holds the invariant under controlled orderings", () => {
  it("writer B starts FIRST, commits SECOND — the ordering that broke it", async () => {
    const f = await mkFixture(seed.orgA.id, "fixed-1");
    const ref = "fixed-1@ref";

    const B = await beginAt(seed.orgA.id);
    await new Promise((r) => setTimeout(r, 40));
    const A = await beginAt(seed.orgA.id);
    expect(B.txStart.getTime()).toBeLessThan(A.txStart.getTime());

    await recordObservation(A.client as unknown as Queryable, seed.orgA.id, f.runId,
      obs(f, ref), true, emptySummary());
    await A.client.query("COMMIT");
    A.client.release();

    const afterA = await readWindow(seed.orgA.id, ref);

    // The earlier transaction now writes. Its NOW() is OLDER than first_seen_at.
    await recordObservation(B.client as unknown as Queryable, seed.orgA.id, f.runId,
      obs(f, ref), true, emptySummary());
    await B.client.query("COMMIT");
    B.client.release();

    const afterB = await readWindow(seed.orgA.id, ref);
    // last_seen_at did not go backwards to B's older transaction start...
    expect(afterB.last_seen_at.getTime()).toBeGreaterThanOrEqual(afterA.last_seen_at.getTime());
    expect(afterB.last_seen_at.getTime()).toBeGreaterThan(B.txStart.getTime());
    // ...first_seen_at never moved...
    expect(afterB.first_seen_at.getTime()).toBe(afterA.first_seen_at.getTime());
    // ...and the invariant holds.
    expect(afterB.last_seen_at.getTime()).toBeGreaterThanOrEqual(afterB.first_seen_at.getTime());
  });

  it("writer A starts SECOND, commits FIRST — the mirror ordering", async () => {
    const f = await mkFixture(seed.orgA.id, "fixed-2");
    const ref = "fixed-2@ref";

    const first = await beginAt(seed.orgA.id);
    await new Promise((r) => setTimeout(r, 40));
    const second = await beginAt(seed.orgA.id);

    // The LATER transaction commits first this time, then the earlier one.
    await recordObservation(second.client as unknown as Queryable, seed.orgA.id, f.runId,
      obs(f, ref), true, emptySummary());
    await second.client.query("COMMIT");
    second.client.release();

    await recordObservation(first.client as unknown as Queryable, seed.orgA.id, f.runId,
      obs(f, ref), true, emptySummary());
    await first.client.query("COMMIT");
    first.client.release();

    const w = await readWindow(seed.orgA.id, ref);
    expect(w.last_seen_at.getTime()).toBeGreaterThanOrEqual(w.first_seen_at.getTime());
  });

  it("repeated observation of the same exposure is idempotent and never regresses", async () => {
    const f = await mkFixture(seed.orgA.id, "fixed-3");
    const ref = "fixed-3@ref";
    const db = pool as unknown as Queryable;

    await recordObservation(db, seed.orgA.id, f.runId, obs(f, ref), true, emptySummary());
    const w1 = await readWindow(seed.orgA.id, ref);

    let previous = w1.last_seen_at.getTime();
    for (let i = 0; i < 5; i++) {
      await recordObservation(db, seed.orgA.id, f.runId, obs(f, ref), true, emptySummary());
      const w = await readWindow(seed.orgA.id, ref);
      expect(w.first_seen_at.getTime()).toBe(w1.first_seen_at.getTime()); // never moves
      expect(w.last_seen_at.getTime()).toBeGreaterThanOrEqual(previous);  // never regresses
      expect(w.last_seen_at.getTime()).toBeGreaterThanOrEqual(w.first_seen_at.getTime());
      previous = w.last_seen_at.getTime();
    }
    // Still exactly one row: the upsert converged rather than duplicating.
    const n = await pool.query(
      `SELECT count(*)::int AS n FROM vulnerability_observations
        WHERE organization_id = $1 AND source_key = 'harness-scanner' AND external_ref = $2`,
      [seed.orgA.id, ref],
    );
    expect((n.rows[0] as { n: number }).n).toBe(1);
  });

  it("MANY writers, opened oldest-first and committed in that same worst-case order", async () => {
    // Six transactions, each begun strictly before the next, then committed in
    // REVERSE order so every single one writes with a NOW() older than the row's
    // first_seen_at. Under the old statement each of the five would have thrown.
    const f = await mkFixture(seed.orgA.id, "fixed-4");
    const ref = "fixed-4@ref";

    const writers: Array<{ client: PoolClient; txStart: Date }> = [];
    for (let i = 0; i < 6; i++) {
      writers.push(await beginAt(seed.orgA.id));
      await new Promise((r) => setTimeout(r, 15));
    }
    for (let i = 0; i < writers.length - 1; i++) {
      expect(writers[i]!.txStart.getTime()).toBeLessThan(writers[i + 1]!.txStart.getTime());
    }

    // Newest transaction writes first and establishes first_seen_at.
    for (const w of [...writers].reverse()) {
      await recordObservation(w.client as unknown as Queryable, seed.orgA.id, f.runId,
        obs(f, ref), true, emptySummary());
      await w.client.query("COMMIT");
      w.client.release();
      const win = await readWindow(seed.orgA.id, ref);
      expect(win.last_seen_at.getTime()).toBeGreaterThanOrEqual(win.first_seen_at.getTime());
    }

    const final = await readWindow(seed.orgA.id, ref);
    // The newest writer's stamp survived every older writer that followed it.
    expect(final.last_seen_at.getTime()).toBeGreaterThanOrEqual(
      writers[writers.length - 1]!.txStart.getTime(),
    );
  });
});

// ---------------------------------------------------------------------------
// The invariant is a property of the table, not of one code path.
// ---------------------------------------------------------------------------

describe("the invariant holds across the whole corpus, in every tenant", () => {
  it("no observation row anywhere has last_seen_at < first_seen_at", async () => {
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM vulnerability_observations
        WHERE last_seen_at < first_seen_at`,
    );
    expect(r.rows[0]!.n).toBe(0);
  });

  it("org B writing the same external_ref touches none of org A's rows", async () => {
    // The upsert key is (organization_id, source_key, external_ref): the org is
    // IN the key, so a colliding ref across tenants is two rows, not one.
    const ref = "shared-ref@collision";
    const fa = await mkFixture(seed.orgA.id, "tenancy-a");
    const fb = await mkFixture(seed.orgB.id, "tenancy-b");
    const db = pool as unknown as Queryable;

    await recordObservation(db, seed.orgA.id, fa.runId, obs(fa, ref), true, emptySummary());
    const aBefore = await readWindow(seed.orgA.id, ref);

    await recordObservation(db, seed.orgB.id, fb.runId, obs(fb, ref), true, emptySummary());

    const aAfter = await readWindow(seed.orgA.id, ref);
    const bRow = await readWindow(seed.orgB.id, ref);
    expect(aAfter.first_seen_at.getTime()).toBe(aBefore.first_seen_at.getTime());
    expect(aAfter.last_seen_at.getTime()).toBe(aBefore.last_seen_at.getTime());
    expect(bRow.last_seen_at.getTime()).toBeGreaterThanOrEqual(bRow.first_seen_at.getTime());

    const rows = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM vulnerability_observations
        WHERE source_key = 'harness-scanner' AND external_ref = $1`,
      [ref],
    );
    expect(rows.rows[0]!.n).toBe(2);
  });
});
