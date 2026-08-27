/**
 * controlMatcherGlobalSignal.test.ts — #883 / F-1 regression, against a REAL
 * Postgres.
 *
 * THE DEFECT
 * ----------
 * `cyber_signals` is one of the tables TENANT_ISOLATION_STANDARD.md §1 names as
 * intentionally NOT org-scoped: public-source intelligence (CISA KEV, NVD,
 * advisory feeds) lands with `organization_id IS NULL` and is cross-org visible
 * by design. The table carries NO RLS policy, so the application predicate is
 * the isolation boundary, and the canonical form — already used by all four
 * signal-link routes — is:
 *
 *     WHERE id = $1 AND (organization_id = $2 OR organization_id IS NULL)
 *
 * Wave 4 (`a8081aca`, #817) moved the LLM control matcher behind a durable
 * queue whose worker RE-READS the signal row, and wrote BOTH new reads as a
 * bare `organization_id = $2`:
 *
 *   1. `controlMatcherWorker.loadSignal`     → no row → job dead-lettered
 *                                              non-retryably as "not found"
 *   2. `llmControlMatcher` phase-1 dedup_hash → no row → outcome `no_controls`,
 *                                              job marked SUCCEEDED, silent
 *
 * Neither can match a global row. Staging 2026-08-20..25: 403 failed
 * `control_matcher_suggest` jobs, 100% of them global, 31 distinct signals
 * permanently lost. `shouldRunControlMatcher` gates on Critical/High, so the
 * signals being dropped were exactly the highest-severity ones.
 *
 * WHY A REAL DATABASE
 * -------------------
 * A mocked `pg.query` returns whatever the test says regardless of the WHERE
 * clause, so a mock can only pin the predicate's TEXT. Only Postgres can prove
 * the predicate's EFFECT: that a NULL-org row is admitted, that another org's
 * private row still is not, and that the suggestions land under the right
 * tenant. That is what CI's 8/8 green missed for five days.
 *
 * NO NETWORK. The provider call is injected everywhere it is reachable; where
 * it is not (the worker calls the matcher with no seam), ANTHROPIC_API_KEY is
 * unset so `defaultLlmCall` short-circuits to `llm_unavailable` without any
 * socket. That is sufficient: the F-1 assertion is about which signals are
 * LOADED, and a load failure is distinguishable from a provider failure.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import {
  runControlMatcherWithOutcome,
  type LlmCallResult,
  type SignalForControlMatch
} from "../../src/api/lib/llmControlMatcher.js";
import {
  enqueueControlMatcherJob,
  CONTROL_MATCHER_JOB_TYPE
} from "../../src/api/lib/controlMatcherQueue.js";
import { claimNextJob, processClaimedJob } from "../../src/api/workers/controlMatcherWorker.js";

let seed: TestDbSeed;
let pool: Pool;

/** orgA's controls, in creation order — the matcher reads them ORDER BY created_at. */
let controlsA: string[] = [];
let controlsB: string[] = [];

let globalSignalId: string;
let orgAPrivateSignalId: string;
let orgBPrivateSignalId: string;

const asSignal = (id: string): SignalForControlMatch => ({
  id,
  signal_type: "vulnerability",
  severity: "Critical",
  normalized_summary: "Critical RCE in a widely deployed edge appliance"
});

/** An injected provider that returns exactly the matches the test asks for. */
const llmReturning = (matches: Array<{ control_id: string; score: number }>) =>
  async (): Promise<LlmCallResult> => ({
    ok: true,
    text: JSON.stringify({
      matches: matches.map((m) => ({ ...m, reasoning: "harness" }))
    }),
    inputTokens: 1000,
    outputTokens: 120
  });

async function seedControl(orgId: string, name: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
    [orgId, name, `${name} description`]
  );
  return res.rows[0].id;
}

async function suggestionsFor(orgId: string, signalId: string) {
  const res = await pool.query<{ target_id: string; match_score: number }>(
    `SELECT target_id, match_score FROM signal_match_suggestions
      WHERE organization_id = $1 AND signal_id = $2 AND target_type = 'control'
      ORDER BY match_score DESC`,
    [orgId, signalId]
  );
  return res.rows;
}

beforeAll(async () => {
  process.env.SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED = "true";
  delete process.env.ANTHROPIC_API_KEY;

  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the global-signal matcher test.");
  pool = new Pool({ connectionString: url, ssl: false });

  controlsA = [
    await seedControl(seed.orgA.id, "A-1 Patch management"),
    await seedControl(seed.orgA.id, "A-2 Network segmentation"),
    await seedControl(seed.orgA.id, "A-3 Asset inventory")
  ];
  controlsB = [await seedControl(seed.orgB.id, "B-1 Patch management")];

  // The row at the centre of #883: public-source, org-less, Critical.
  globalSignalId = await seedCyberSignal(pool, {
    orgId: null,
    signalType: "vulnerability",
    severity: "Critical",
    source: "security_news_thehackernews",
    summary: "Critical RCE in a widely deployed edge appliance",
    dedup: "sha256:global-critical-rce"
  });
  orgAPrivateSignalId = await seedCyberSignal(pool, {
    orgId: seed.orgA.id,
    signalType: "vulnerability",
    severity: "Critical",
    summary: "Org A private incident signal",
    dedup: "sha256:orgA-private"
  });
  orgBPrivateSignalId = await seedCyberSignal(pool, {
    orgId: seed.orgB.id,
    signalType: "vulnerability",
    severity: "Critical",
    summary: "Org B private incident signal",
    dedup: "sha256:orgB-private"
  });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM signal_match_suggestions`);
  await pool.query(`DELETE FROM llm_control_matcher_verdicts`);
  await pool.query(`DELETE FROM jobs WHERE job_type = $1`, [CONTROL_MATCHER_JOB_TYPE]);
});

// ---------------------------------------------------------------------------
// 1. The matcher core, against real rows.
// ---------------------------------------------------------------------------

describe("runControlMatcherWithOutcome — global signals reach the matcher", () => {
  it("a GLOBAL signal produces control suggestions for the org (the #883 regression)", async () => {
    const outcome = await runControlMatcherWithOutcome(
      asSignal(globalSignalId),
      seed.orgA.id,
      llmReturning([
        { control_id: controlsA[0], score: 91 },
        { control_id: controlsA[1], score: 74 }
      ])
    );

    // Before the fix this was { written: 0, outcome: "no_controls" } — the
    // dedup_hash read found nothing, phase 1 returned null, and the run was
    // mislabelled as "this org has no controls".
    expect(outcome).toMatchObject({ outcome: "written", written: 2, retryable: false });

    const rows = await suggestionsFor(seed.orgA.id, globalSignalId);
    expect(rows.map((r) => r.target_id)).toEqual([controlsA[0], controlsA[1]]);
  });

  it("an ORG-SCOPED signal still works — the fix does not trade one path for the other", async () => {
    const outcome = await runControlMatcherWithOutcome(
      asSignal(orgAPrivateSignalId),
      seed.orgA.id,
      llmReturning([{ control_id: controlsA[2], score: 88 }])
    );

    expect(outcome).toMatchObject({ outcome: "written", written: 1 });
    expect((await suggestionsFor(seed.orgA.id, orgAPrivateSignalId))[0].target_id).toBe(
      controlsA[2]
    );
  });

  it("ZERO matches is a real answer, not a failure — nothing written, verdict cached", async () => {
    const outcome = await runControlMatcherWithOutcome(
      asSignal(globalSignalId),
      seed.orgA.id,
      llmReturning([])
    );

    expect(outcome).toMatchObject({ outcome: "written", written: 0, retryable: false });
    expect(await suggestionsFor(seed.orgA.id, globalSignalId)).toHaveLength(0);

    // The empty answer is cached: an org with no relevant controls must not be
    // re-charged for the same global signal on the next pass.
    const cached = await pool.query(
      `SELECT state, verdict FROM llm_control_matcher_verdicts WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(cached.rowCount).toBe(1);
    expect(cached.rows[0].state).toBe("answered");
    expect(cached.rows[0].verdict).toEqual({ matches: [] });
  });

  it("MULTIPLE matches are ranked, threshold-filtered and capped", async () => {
    const outcome = await runControlMatcherWithOutcome(
      asSignal(globalSignalId),
      seed.orgA.id,
      llmReturning([
        { control_id: controlsA[1], score: 62 },
        { control_id: controlsA[0], score: 95 },
        // Below CONTROL_MATCH_MIN_SCORE (50) — must be dropped, not written weak.
        { control_id: controlsA[2], score: 12 }
      ])
    );

    expect(outcome.written).toBe(2);
    const rows = await suggestionsFor(seed.orgA.id, globalSignalId);
    expect(rows.map((r) => r.target_id)).toEqual([controlsA[0], controlsA[1]]);
    expect(rows.map((r) => Number(r.match_score))).toEqual([95, 62]);
  });

  it("a hallucinated control id belonging to ANOTHER ORG is dropped, not written", async () => {
    // The sharpest cross-org assertion available at this layer: the provider
    // names org B's control while running for org A. `knownIds` is built from
    // org A's own inventory, so the id must never reach the INSERT.
    const outcome = await runControlMatcherWithOutcome(
      asSignal(globalSignalId),
      seed.orgA.id,
      llmReturning([
        { control_id: controlsB[0], score: 99 },
        { control_id: controlsA[0], score: 80 }
      ])
    );

    expect(outcome.written).toBe(1);
    const rows = await suggestionsFor(seed.orgA.id, globalSignalId);
    expect(rows.map((r) => r.target_id)).toEqual([controlsA[0]]);

    const leaked = await pool.query(
      `SELECT 1 FROM signal_match_suggestions WHERE target_id = $1`,
      [controlsB[0]]
    );
    expect(leaked.rowCount).toBe(0);
  });

  it("the SAME global signal in two orgs produces two independent, non-leaking result sets", async () => {
    await runControlMatcherWithOutcome(
      asSignal(globalSignalId),
      seed.orgA.id,
      llmReturning([{ control_id: controlsA[0], score: 90 }])
    );
    await runControlMatcherWithOutcome(
      asSignal(globalSignalId),
      seed.orgB.id,
      llmReturning([{ control_id: controlsB[0], score: 70 }])
    );

    const a = await suggestionsFor(seed.orgA.id, globalSignalId);
    const b = await suggestionsFor(seed.orgB.id, globalSignalId);
    expect(a.map((r) => r.target_id)).toEqual([controlsA[0]]);
    expect(b.map((r) => r.target_id)).toEqual([controlsB[0]]);

    // Two verdict rows under the SAME signal_dedup_hash, separated only by
    // organization_id — the collision llmVerdictCacheRls.test.ts proves RLS
    // holds under. This is the run that makes that collision real in
    // production, and it only becomes reachable once #883 is fixed.
    const verdicts = await pool.query<{ organization_id: string; signal_dedup_hash: string }>(
      `SELECT organization_id, signal_dedup_hash FROM llm_control_matcher_verdicts ORDER BY organization_id`
    );
    expect(verdicts.rowCount).toBe(2);
    expect(new Set(verdicts.rows.map((r) => r.signal_dedup_hash)).size).toBe(1);
    expect(new Set(verdicts.rows.map((r) => r.organization_id)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. The worker's own read — `loadSignal`, the first half of #883.
// ---------------------------------------------------------------------------

describe("controlMatcherWorker.loadSignal — via a real claimed job", () => {
  /**
   * With ANTHROPIC_API_KEY unset the provider call resolves to
   * `llm_unavailable` without opening a socket, so the matcher's outcome is
   * `provider_failed` / retryable. That is the discriminator this test needs:
   *
   *   signal NOT loaded  → NonRetryableJobError "not found" → status 'failed'
   *   signal loaded      → provider path → status 'queued' with a backoff
   *
   * The defect produced the first; the fix produces the second.
   */
  async function runOneJobFor(orgId: string, signalId: string) {
    await enqueueControlMatcherJob(pool, orgId, asSignal(signalId));
    const job = await claimNextJob("harness-worker");
    expect(job, "a job should have been enqueued and claimable").not.toBeNull();
    await processClaimedJob(job!);
    const res = await pool.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM jobs WHERE id = $1`,
      [job!.id]
    );
    return res.rows[0];
  }

  it("a job for a GLOBAL signal LOADS the signal — no 'not found', no dead-letter", async () => {
    const row = await runOneJobFor(seed.orgA.id, globalSignalId);

    expect(row.error ?? "").not.toMatch(/not found/i);
    expect(row.status).not.toBe("failed");
    // It reached the provider, which is unavailable in the harness → retryable.
    expect(row.status).toBe("queued");
  });

  it("a job for the org's OWN signal still loads — unchanged behaviour", async () => {
    const row = await runOneJobFor(seed.orgA.id, orgAPrivateSignalId);
    expect(row.error ?? "").not.toMatch(/not found/i);
    expect(row.status).toBe("queued");
  });

  it("a job naming ANOTHER ORG's private signal is still refused permanently", async () => {
    // The load must fail: org B's row is neither same-org nor global. This is
    // the negative control that proves the fix admitted globals WITHOUT
    // admitting other tenants' rows.
    const row = await runOneJobFor(seed.orgA.id, orgBPrivateSignalId);

    expect(row.status).toBe("failed");
    expect(row.error ?? "").toMatch(/not found/i);
  });

  it("a job naming a signal that does not exist at all is still refused permanently", async () => {
    const row = await runOneJobFor(seed.orgA.id, "00000000-0000-4000-8000-0000000000ff");
    expect(row.status).toBe("failed");
    expect(row.error ?? "").toMatch(/not found/i);
  });
});
