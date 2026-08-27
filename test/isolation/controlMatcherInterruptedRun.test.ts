/**
 * controlMatcherInterruptedRun.test.ts — TIER 2A deterministic fault/recovery,
 * against a REAL Postgres.
 *
 * WHY THIS EXISTS INSTEAD OF WAITING FOR AN OUTAGE
 * ------------------------------------------------
 * #826 asked for these to be proven by observing a live staging run:
 *
 *   - "An interrupted or incomplete run reconciles on the following pass"
 *   - "No org left permanently in 'generating'"
 *   - "Catch-up regenerates only what is genuinely missing — no duplicate edition"
 *   - "No signal permanently lost across a worker restart"
 *
 * Every one of those is conditional on an INTERRUPTION, and a healthy staging
 * run produces none. Waiting for the cron cannot exercise them; it can only
 * fail to contradict them. The mocked logic coverage in
 * briefSchedulerReconciliation.test.ts and controlMatcherAsync.test.ts is
 * retained and unchanged — what was missing is a proof that the RECOVERY
 * MECHANISM behaves as designed against the real schema, real indexes and real
 * clock arithmetic. This file creates the interruption state deterministically
 * and drives the real recovery path over it. No infrastructure outage, no
 * SIGTERM, no destructive staging fixture.
 *
 * THE FAULT MODEL
 * ---------------
 * A worker that dies mid-job leaves exactly one artefact: a `jobs` row stuck in
 * `status='processing'` with a `locked_at` that stops advancing. That is the
 * whole of the durable interruption state, and it is trivially forgeable — set
 * `locked_at` into the past. Everything downstream (re-claim, attempt
 * accounting, terminal state, no-double-execution) is then the real code.
 *
 * NO NETWORK. ANTHROPIC_API_KEY is unset, so `defaultLlmCall` short-circuits.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import {
  enqueueControlMatcherJob,
  CONTROL_MATCHER_JOB_TYPE
} from "../../src/api/lib/controlMatcherQueue.js";
import {
  claimNextJob,
  processClaimedJob,
  runOneTick
} from "../../src/api/workers/controlMatcherWorker.js";
import { LOCK_TIMEOUT_MS } from "../../src/api/lib/dataRightsWorkerPolicy.js";
import {
  runControlMatcherWithOutcome,
  type LlmCallResult,
  type SignalForControlMatch
} from "../../src/api/lib/llmControlMatcher.js";
import { listOrgsWithCurrentBrief } from "../../src/api/lib/briefScheduler.js";

let seed: TestDbSeed;
let pool: Pool;
let controlA: string;
let globalSignalId: string;

const signalFor = (id: string): SignalForControlMatch => ({
  id,
  signal_type: "vulnerability",
  severity: "Critical",
  normalized_summary: "Critical RCE, global signal"
});

async function jobRow(id: string) {
  const res = await pool.query<{
    id: string;
    status: string;
    attempts: number;
    locked_by: string | null;
    locked_at: Date | null;
    error: string | null;
    result: unknown;
  }>(
    `SELECT id, status, attempts, locked_by, locked_at, error, result FROM jobs WHERE id = $1`,
    [id]
  );
  return res.rows[0];
}

/** Forge the ONLY durable artefact a dead worker leaves behind. */
async function simulateWorkerDeath(jobId: string, staleByMs = LOCK_TIMEOUT_MS + 60_000) {
  await pool.query(
    `UPDATE jobs
        SET status = 'processing',
            locked_by = 'worker-that-died',
            locked_at = now() - ($2::bigint * interval '1 millisecond')
      WHERE id = $1`,
    [jobId, staleByMs]
  );
}

beforeAll(async () => {
  process.env.SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED = "true";
  delete process.env.ANTHROPIC_API_KEY;

  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the interrupted-run test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const c = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
    [seed.orgA.id, "A-1 Patch management", "patching"]
  );
  controlA = c.rows[0].id;

  globalSignalId = await seedCyberSignal(pool, {
    orgId: null,
    signalType: "vulnerability",
    severity: "Critical",
    summary: "Critical RCE, global signal",
    dedup: "sha256:interrupted-run-global-signal"
  });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM jobs WHERE job_type = $1`, [CONTROL_MATCHER_JOB_TYPE]);
  await pool.query(`DELETE FROM llm_control_matcher_verdicts`);
  await pool.query(`DELETE FROM signal_match_suggestions`);
  await pool.query(`DELETE FROM intelligence_briefs`);
});

// ---------------------------------------------------------------------------
// A. The matcher queue recovers work abandoned by a dead worker.
// ---------------------------------------------------------------------------

describe("matcher queue — a job abandoned mid-flight is recovered, not lost", () => {
  it("job begins → worker dies → the next tick RE-CLAIMS it and drives it to a terminal state", async () => {
    const jobId = (await enqueueControlMatcherJob(pool, seed.orgA.id, signalFor(globalSignalId)))!;
    expect(jobId).toBeTruthy();

    // 1. The job begins: a live worker claims it.
    const claimed = await claimNextJob("worker-1");
    expect(claimed!.id).toBe(jobId);
    expect(claimed!.attempts).toBe(1);
    expect((await jobRow(jobId)).status).toBe("processing");

    // 2. The interruption. The process is gone; the row is all that remains.
    await simulateWorkerDeath(jobId);

    // 3. A fresh worker's ordinary claim poll — no special recovery job, no
    //    operator action. This is the reconciliation.
    const reclaimed = await claimNextJob("worker-2");
    expect(reclaimed, "a stranded job MUST be re-claimable").not.toBeNull();
    expect(reclaimed!.id).toBe(jobId);
    expect(reclaimed!.locked_by ?? "worker-2").toBeTruthy();
    // The re-claim consumes budget, which is what makes exhaustion reachable
    // even if every attempt dies mid-flight.
    expect(reclaimed!.attempts).toBe(2);

    // 4. Recoverable work returns to a correct, non-terminal state (the
    //    provider is unavailable in the harness → retry with backoff), NOT to a
    //    wrong terminal one.
    await processClaimedJob(reclaimed!);
    const after = await jobRow(jobId);
    expect(after.status).toBe("queued");
    expect(after.locked_by).toBeNull();
    expect(after.locked_at).toBeNull();
  });

  it("a FRESH lock is NOT stolen — recovery must not race a live worker", async () => {
    const jobId = (await enqueueControlMatcherJob(pool, seed.orgA.id, signalFor(globalSignalId)))!;
    await claimNextJob("worker-1");

    // Lock is recent (well inside LOCK_TIMEOUT_MS): still someone's work.
    await simulateWorkerDeath(jobId, 1_000);

    const stolen = await claimNextJob("worker-2");
    expect(stolen, "a live worker's job must not be re-claimed").toBeNull();
  });

  it("re-execution does NOT duplicate the work — the verdict is replayed, the rows are identical", async () => {
    // The interruption that matters most: the matcher's rows committed, then
    // the terminal bookkeeping was lost. Re-execution must be free and
    // non-duplicating, which is the reservation/replay contract the async
    // refactor rests on.
    let calls = 0;
    const llm = async (): Promise<LlmCallResult> => {
      calls++;
      return {
        ok: true,
        text: JSON.stringify({ matches: [{ control_id: controlA, score: 88, reasoning: "r" }] }),
        inputTokens: 1000,
        outputTokens: 100
      };
    };

    const first = await runControlMatcherWithOutcome(signalFor(globalSignalId), seed.orgA.id, llm);
    expect(first).toMatchObject({ outcome: "written", written: 1 });

    // ... interruption here: the job row never reached 'succeeded' ...

    const replay = await runControlMatcherWithOutcome(signalFor(globalSignalId), seed.orgA.id, llm);
    expect(replay.outcome).toBe("cache_hit");
    expect(calls).toBe(1); // no duplicate provider spend

    const rows = await pool.query(
      `SELECT id FROM signal_match_suggestions WHERE organization_id = $1 AND signal_id = $2`,
      [seed.orgA.id, globalSignalId]
    );
    expect(rows.rowCount).toBe(1); // no duplicate suggestion
  });

  it("repeated death eventually DEAD-LETTERS visibly rather than looping forever", async () => {
    const jobId = (await enqueueControlMatcherJob(pool, seed.orgA.id, signalFor(globalSignalId)))!;
    await pool.query(`UPDATE jobs SET max_attempts = 3 WHERE id = $1`, [jobId]);

    let last = await jobRow(jobId);
    for (let i = 0; i < 6 && last.status !== "dead_lettered"; i++) {
      await pool.query(
        `UPDATE jobs SET status = 'queued', scheduled_for = now() - interval '1 hour',
                         next_attempt_at = NULL, locked_by = NULL, locked_at = NULL
          WHERE id = $1`,
        [jobId]
      );
      const job = await claimNextJob(`worker-${i}`);
      if (!job) break;
      await processClaimedJob(job);
      last = await jobRow(jobId);
    }

    // Terminal and LOUD — the retry budget is finite, so a permanently broken
    // job surfaces for a human instead of cycling.
    expect(last.status).toBe("dead_lettered");
    expect(last.attempts).toBeGreaterThanOrEqual(3);
  });

  it("a tick drains a MIX of queued and stranded jobs in one pass", async () => {
    const stranded = (await enqueueControlMatcherJob(pool, seed.orgA.id, signalFor(globalSignalId)))!;
    await claimNextJob("worker-dead");
    await simulateWorkerDeath(stranded);

    const orgSignal = await seedCyberSignal(pool, {
      orgId: seed.orgA.id,
      signalType: "vulnerability",
      severity: "Critical",
      summary: "org A private",
      dedup: `sha256:mix-${Date.now()}`
    });
    const fresh = (await enqueueControlMatcherJob(pool, seed.orgA.id, signalFor(orgSignal)))!;

    const processed = await runOneTick({ workerId: "worker-recovery" });
    expect(processed).toBe(2);

    for (const id of [stranded, fresh]) {
      const row = await jobRow(id);
      // Neither is left in 'processing', and neither failed as "not found".
      expect(row.status).not.toBe("processing");
      expect(row.error ?? "").not.toMatch(/not found/i);
    }
  });

  it("recovery is TENANT-CORRECT — org B's stranded job never lands under org A", async () => {
    const orgBSignal = await seedCyberSignal(pool, {
      orgId: seed.orgB.id,
      signalType: "vulnerability",
      severity: "Critical",
      summary: "org B private",
      dedup: `sha256:orgB-stranded-${Date.now()}`
    });
    const bJob = (await enqueueControlMatcherJob(pool, seed.orgB.id, signalFor(orgBSignal)))!;
    await claimNextJob("worker-dead");
    await simulateWorkerDeath(bJob);

    const reclaimed = await claimNextJob("worker-recovery");
    expect(reclaimed!.organization_id).toBe(seed.orgB.id);
    await processClaimedJob(reclaimed!);

    // Whatever the outcome, nothing was written under the wrong tenant.
    const leaked = await pool.query(
      `SELECT 1 FROM signal_match_suggestions WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(leaked.rowCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. The Brief scheduler's own reconciliation predicate.
// ---------------------------------------------------------------------------

describe("brief reconciliation — an interrupted org is retried, a finished org is not", () => {
  const weekStart = new Date("2026-07-07T07:00:00Z");

  async function seedBrief(orgId: string, status: string, generatedAt: Date | null) {
    await pool.query(
      `INSERT INTO intelligence_briefs
         (organization_id, period_start, period_end, status, generated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, weekStart, new Date(weekStart.getTime() + 7 * 86_400_000), status, generatedAt]
    );
  }

  it("an org stuck in 'generating' is NOT in the skip set — it is reconciled next pass", async () => {
    // The exact residue of the 2026-08-11 mid-loop SIGTERM.
    await seedBrief(seed.orgA.id, "generating", new Date(weekStart.getTime() + 3600_000));

    const skip = await listOrgsWithCurrentBrief(weekStart);
    expect(skip.has(seed.orgA.id)).toBe(false);
  });

  it("an org whose run FAILED is NOT in the skip set either", async () => {
    await seedBrief(seed.orgA.id, "failed", new Date(weekStart.getTime() + 3600_000));
    const skip = await listOrgsWithCurrentBrief(weekStart);
    expect(skip.has(seed.orgA.id)).toBe(false);
  });

  it("an org that PUBLISHED this week IS skipped — no duplicate edition, no re-send", async () => {
    await seedBrief(seed.orgA.id, "published", new Date(weekStart.getTime() + 3600_000));
    const skip = await listOrgsWithCurrentBrief(weekStart);
    expect(skip.has(seed.orgA.id)).toBe(true);
  });

  it("LAST week's published brief does not skip THIS week", async () => {
    await seedBrief(seed.orgA.id, "published", new Date(weekStart.getTime() - 86_400_000));
    const skip = await listOrgsWithCurrentBrief(weekStart);
    expect(skip.has(seed.orgA.id)).toBe(false);
  });

  it("the skip set is per-org: A finished, B interrupted → only B is reconciled", async () => {
    await seedBrief(seed.orgA.id, "published", new Date(weekStart.getTime() + 3600_000));
    await seedBrief(seed.orgB.id, "generating", new Date(weekStart.getTime() + 3600_000));

    const skip = await listOrgsWithCurrentBrief(weekStart);
    expect(skip.has(seed.orgA.id)).toBe(true);
    expect(skip.has(seed.orgB.id)).toBe(false);
    expect(skip.size).toBe(1);
  });
});
