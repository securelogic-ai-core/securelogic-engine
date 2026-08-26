/**
 * verdictCacheDigestRecompute.test.ts — TIER 2A deterministic proof of the
 * verdict cache's IDENTITY semantics, against a REAL Postgres.
 *
 * WHY THIS EXISTS INSTEAD OF WAITING FOR THE CRON
 * ------------------------------------------------
 * #826 asked for three of these to be proven by watching the natural Tuesday
 * 07:00Z staging run:
 *
 *   - "A real control-inventory change alters control_inventory_digest, and the
 *      next lookup for the same (org, signal_dedup_hash) is a MISS"
 *   - "state='answered' is the only state ever reused"
 *   - "No cross-org key collision despite identical signal_dedup_hash values"
 *
 * None of those needs a deployed environment. They are properties of a SQL key
 * and a policy function, and a live run can only demonstrate them by accident —
 * it cannot force a digest change, cannot manufacture a non-reusable state, and
 * on staging never produced a colliding key at all. This file forces all three
 * deterministically, on the real schema, with the real unique index.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * `tokens_saved > 0`. See §3 of the Tier-2 remediation ruling and
 * docs/investigation/tier-2-gate-design.md: within one org a dedup_hash is
 * UNIQUE by construction (`20260420_cyber_signals_allow_null_org.sql` plus the
 * (organization_id, dedup_hash) index), so a second DISTINCT signal can never
 * reuse a first one's verdict. Answer-reuse is reachable only by RE-EXECUTING
 * the same (org, signal, digest, prompt) — the idempotent-replay path proven in
 * the last describe below. That path is load-bearing for duplicate safety; it
 * is NOT a token-saving path, and no gate should demand one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import {
  lookupVerdict,
  reserveVerdict,
  recordAnsweredVerdict,
  recordFailedVerdict,
  type VerdictKey
} from "../../src/api/lib/llm/verdictCache.js";
import {
  controlInventoryDigest,
  VERDICT_RESERVATION_TIMEOUT_MS
} from "../../src/api/lib/llm/verdictCachePolicy.js";
import {
  runControlMatcherWithOutcome,
  type LlmCallResult,
  type SignalForControlMatch
} from "../../src/api/lib/llmControlMatcher.js";
import { withTenant } from "../../src/api/infra/postgres.js";

let seed: TestDbSeed;
let pool: Pool;
let controlsA: Array<{ id: string; name: string; description: string | null }> = [];
let controlB: { id: string; name: string; description: string | null };
let globalSignalId: string;

const PROMPT_VERSION = "control-matcher-v1";
/** Identical across orgs by construction — the same CVE hashes the same everywhere. */
const SHARED_HASH = "sha256:the-same-cve-everywhere";

const usage = { model: "claude-sonnet-4-6", inputTokens: 1200, outputTokens: 300 };
const answer = (label: string) => ({
  matches: [{ control_id: label, score: 90, reasoning: "r" }]
});

const keyFor = (orgId: string, digest: string, hash = SHARED_HASH): VerdictKey => ({
  organizationId: orgId,
  signalDedupHash: hash,
  controlInventoryDigest: digest,
  promptVersion: PROMPT_VERSION
});

async function seedControl(orgId: string, name: string) {
  const res = await pool.query<{ id: string; name: string; description: string | null }>(
    `INSERT INTO controls (organization_id, name, description) VALUES ($1, $2, $3)
     RETURNING id, name, description`,
    [orgId, name, `${name} description`]
  );
  return res.rows[0];
}

beforeAll(async () => {
  process.env.SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED = "true";
  delete process.env.ANTHROPIC_API_KEY;

  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the digest-recompute test.");
  pool = new Pool({ connectionString: url, ssl: false });

  controlsA = [
    await seedControl(seed.orgA.id, "A-1 Patch management"),
    await seedControl(seed.orgA.id, "A-2 Network segmentation")
  ];
  controlB = await seedControl(seed.orgB.id, "B-1 Patch management");

  globalSignalId = await seedCyberSignal(pool, {
    orgId: null,
    signalType: "vulnerability",
    severity: "Critical",
    summary: "Critical RCE, global signal",
    dedup: "sha256:digest-suite-global-signal"
  });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM llm_control_matcher_verdicts`);
  await pool.query(`DELETE FROM signal_match_suggestions`);
});

// ---------------------------------------------------------------------------
// A. Digest change forces recomputation.
// ---------------------------------------------------------------------------

describe("control-inventory digest — same identity reuses, changed identity recomputes", () => {
  it("the SAME control inventory yields the SAME digest, and the stored answer is reused", async () => {
    const digest = controlInventoryDigest(controlsA);
    const key = keyFor(seed.orgA.id, digest);

    await withTenant(seed.orgA.id, async () => {
      await reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      await recordAnsweredVerdict(key, answer("control-A1"), usage);
    });

    // Recompute the digest from the SAME rows read back out of the database —
    // not from the in-memory array — so this proves stability of the hash over
    // a real round trip, which is what the live path actually does.
    const reread = await pool.query<{ id: string; name: string; description: string | null }>(
      `SELECT id, name, description FROM controls WHERE organization_id = $1 ORDER BY created_at ASC`,
      [seed.orgA.id]
    );
    expect(controlInventoryDigest(reread.rows)).toBe(digest);

    const lookup = await withTenant(seed.orgA.id, () =>
      lookupVerdict(keyFor(seed.orgA.id, controlInventoryDigest(reread.rows)))
    );
    expect(lookup.outcome).toBe("hit");
    expect(lookup.outcome === "hit" && lookup.verdict).toEqual(answer("control-A1"));
    // Reuse replays the ORIGINAL call's cost, which is what any saving claim
    // would have to be measured from.
    expect(lookup.outcome === "hit" && lookup.inputTokens).toBe(1200);
  });

  it("ADDING a control changes the digest and the next lookup MISSES with control_inventory_changed", async () => {
    const before = controlInventoryDigest(controlsA);
    await withTenant(seed.orgA.id, async () => {
      await reserveVerdict(keyFor(seed.orgA.id, before), new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      await recordAnsweredVerdict(keyFor(seed.orgA.id, before), answer("stale"), usage);
    });

    const added = await seedControl(seed.orgA.id, "A-3 Vulnerability scanning");
    try {
      const after = controlInventoryDigest([...controlsA, added]);
      expect(after).not.toBe(before);

      const lookup = await withTenant(seed.orgA.id, () =>
        lookupVerdict(keyFor(seed.orgA.id, after))
      );
      // The decisive assertion: the stale verdict is NOT served under the new
      // inventory. A fresh computation follows.
      expect(lookup.outcome).toBe("miss");
      expect(lookup.outcome === "miss" && lookup.reason).toBe("control_inventory_changed");
    } finally {
      await pool.query(`DELETE FROM controls WHERE id = $1`, [added.id]);
    }
  });

  it("RENAMING a control changes the digest too — content, not just cardinality", async () => {
    const before = controlInventoryDigest(controlsA);
    const renamed = [{ ...controlsA[0], name: "A-1 Patch and update management" }, controlsA[1]];
    expect(controlInventoryDigest(renamed)).not.toBe(before);
  });

  it("a PROMPT-VERSION bump is reported as its own miss reason, not as inventory churn", async () => {
    const digest = controlInventoryDigest(controlsA);
    await withTenant(seed.orgA.id, async () => {
      await reserveVerdict(keyFor(seed.orgA.id, digest), new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      await recordAnsweredVerdict(keyFor(seed.orgA.id, digest), answer("v1"), usage);
    });

    const lookup = await withTenant(seed.orgA.id, () =>
      lookupVerdict({ ...keyFor(seed.orgA.id, digest), promptVersion: "control-matcher-v2" })
    );
    expect(lookup.outcome).toBe("miss");
    expect(lookup.outcome === "miss" && lookup.reason).toBe("prompt_version_changed");
  });
});

// ---------------------------------------------------------------------------
// B. Only 'answered' is ever reused.
// ---------------------------------------------------------------------------

describe("reuse is restricted to state='answered'", () => {
  it("an UNPARSEABLE row is never served — the next lookup is a miss, not a stale answer", async () => {
    const key = keyFor(seed.orgA.id, controlInventoryDigest(controlsA));
    await withTenant(seed.orgA.id, async () => {
      await reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      // nextAttemptAt in the past → the backoff has elapsed, so this is a
      // genuine retry opportunity rather than a live reservation.
      await recordFailedVerdict(key, {
        state: "unparseable",
        parseErrorCode: "not_json",
        nextAttemptAt: new Date(Date.now() - 60_000)
      });
    });

    const lookup = await withTenant(seed.orgA.id, () => lookupVerdict(key));
    expect(lookup.outcome).toBe("miss");
    expect(lookup.outcome === "miss" && lookup.reason).toBe("non_reusable_state");
  });

  it("a FAILED row with an elapsed backoff is a miss, and re-reservation consumes the budget", async () => {
    const key = keyFor(seed.orgA.id, controlInventoryDigest(controlsA));
    await withTenant(seed.orgA.id, async () => {
      const first = await reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      expect(first).toMatchObject({ claimed: true, attempts: 1 });
      await recordFailedVerdict(key, {
        state: "failed",
        failureClass: "transport",
        nextAttemptAt: new Date(Date.now() - 60_000)
      });

      expect((await lookupVerdict(key)).outcome).toBe("miss");
      const second = await reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      expect(second).toMatchObject({ claimed: true, attempts: 2 });
    });
  });

  it("a DEAD-LETTERED row is skipped, never reused and never auto-retried", async () => {
    const key = keyFor(seed.orgA.id, controlInventoryDigest(controlsA));
    await withTenant(seed.orgA.id, async () => {
      await reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      await recordFailedVerdict(key, { state: "dead_lettered", nextAttemptAt: null });
    });

    const lookup = await withTenant(seed.orgA.id, () => lookupVerdict(key));
    expect(lookup.outcome).toBe("skip");
    expect(lookup.outcome === "skip" && lookup.reason).toBe("dead_lettered");
    // And no further spend can be claimed against it.
    const reclaim = await withTenant(seed.orgA.id, () =>
      reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS)
    );
    expect(reclaim.claimed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. No cross-org reuse, under a deliberately colliding key.
// ---------------------------------------------------------------------------

describe("cross-org isolation of the cache key", () => {
  it("org B does NOT reuse org A's answer under an identical hash AND identical digest", async () => {
    // Force the digests equal as well as the hashes — the hardest case, and one
    // the live staging run never produced. If reuse were keyed on anything less
    // than organization_id, this would return org A's verdict.
    const sharedDigest = "sha256:deliberately-identical-inventory";

    await withTenant(seed.orgA.id, async () => {
      await reserveVerdict(keyFor(seed.orgA.id, sharedDigest), new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      await recordAnsweredVerdict(keyFor(seed.orgA.id, sharedDigest), answer("A-only"), usage);
    });

    const bLookup = await withTenant(seed.orgB.id, () =>
      lookupVerdict(keyFor(seed.orgB.id, sharedDigest))
    );
    expect(bLookup.outcome).toBe("miss");
    expect(bLookup.outcome === "miss" && bLookup.reason).toBe("absent");

    // B computing its own answer must not disturb A's.
    await withTenant(seed.orgB.id, async () => {
      await reserveVerdict(keyFor(seed.orgB.id, sharedDigest), new Date(), VERDICT_RESERVATION_TIMEOUT_MS);
      await recordAnsweredVerdict(keyFor(seed.orgB.id, sharedDigest), answer("B-only"), usage);
    });

    const rows = await pool.query<{ organization_id: string; verdict: unknown }>(
      `SELECT organization_id, verdict FROM llm_control_matcher_verdicts
        WHERE signal_dedup_hash = $1 ORDER BY organization_id`,
      [SHARED_HASH]
    );
    expect(rows.rowCount).toBe(2);
    for (const r of rows.rows) {
      const expected = r.organization_id === seed.orgA.id ? "A-only" : "B-only";
      expect(JSON.stringify(r.verdict)).toContain(expected);
    }
  });

  it("org A's reservation does NOT block org B from computing the same signal", async () => {
    const sharedDigest = "sha256:deliberately-identical-inventory";
    const aClaim = await withTenant(seed.orgA.id, () =>
      reserveVerdict(keyFor(seed.orgA.id, sharedDigest), new Date(), VERDICT_RESERVATION_TIMEOUT_MS)
    );
    const bClaim = await withTenant(seed.orgB.id, () =>
      reserveVerdict(keyFor(seed.orgB.id, sharedDigest), new Date(), VERDICT_RESERVATION_TIMEOUT_MS)
    );
    // Stampede control is PER TENANT. One org's in-flight work must never
    // suppress another org's suggestions for the same public CVE.
    expect(aClaim.claimed).toBe(true);
    expect(bClaim.claimed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Reservation (A) vs answer-reuse (B) — the split the ruling requires.
// ---------------------------------------------------------------------------

describe("reservation is load-bearing; answer-reuse is the idempotent-replay path", () => {
  it("a SECOND concurrent worker loses the reservation and makes NO provider call", async () => {
    const key = keyFor(seed.orgA.id, controlInventoryDigest(controlsA));
    const first = await withTenant(seed.orgA.id, () =>
      reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS)
    );
    const second = await withTenant(seed.orgA.id, () =>
      reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS)
    );
    expect(first.claimed).toBe(true);
    // This is the duplicate-LLM-spend guard #826 asks for. It is worth keeping
    // and worth testing regardless of whether any answer is ever reused.
    expect(second.claimed).toBe(false);
  });

  it("a STALE reservation (dead worker) is re-claimable — deferral is not permanent loss", async () => {
    const key = keyFor(seed.orgA.id, controlInventoryDigest(controlsA));
    const reservedAt = new Date(Date.now() - VERDICT_RESERVATION_TIMEOUT_MS - 60_000);
    await withTenant(seed.orgA.id, () =>
      reserveVerdict(key, reservedAt, VERDICT_RESERVATION_TIMEOUT_MS)
    );
    const reclaim = await withTenant(seed.orgA.id, () =>
      reserveVerdict(key, new Date(), VERDICT_RESERVATION_TIMEOUT_MS)
    );
    expect(reclaim).toMatchObject({ claimed: true, attempts: 2 });
  });

  it("RE-EXECUTING the same (org, signal) replays the verdict for zero provider spend", async () => {
    // The ONLY reachable answer-reuse path in the current architecture: the
    // worker re-claims a job whose matcher work already committed but whose
    // terminal bookkeeping did not. It writes identical rows and calls nothing.
    const signal: SignalForControlMatch = {
      id: globalSignalId,
      signal_type: "vulnerability",
      severity: "Critical",
      normalized_summary: "Critical RCE, global signal"
    };
    let calls = 0;
    const llm = async (): Promise<LlmCallResult> => {
      calls++;
      return {
        ok: true,
        text: JSON.stringify({ matches: [{ control_id: controlsA[0].id, score: 88, reasoning: "r" }] }),
        inputTokens: 1000,
        outputTokens: 100
      };
    };

    const first = await runControlMatcherWithOutcome(signal, seed.orgA.id, llm);
    expect(first).toMatchObject({ outcome: "written", written: 1 });
    expect(calls).toBe(1);

    const second = await runControlMatcherWithOutcome(signal, seed.orgA.id, llm);
    expect(second.outcome).toBe("cache_hit");
    expect(calls).toBe(1); // no second provider call

    // Identical rows, not duplicated ones.
    const rows = await pool.query(
      `SELECT target_id FROM signal_match_suggestions
        WHERE organization_id = $1 AND signal_id = $2`,
      [seed.orgA.id, globalSignalId]
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].target_id).toBe(controlsA[0].id);
  });

  it("cross-org: org B re-running the same GLOBAL signal gets its OWN answer, not org A's", async () => {
    const signal: SignalForControlMatch = {
      id: globalSignalId,
      signal_type: "vulnerability",
      severity: "Critical",
      normalized_summary: "Critical RCE, global signal"
    };
    const llmFor = (controlId: string) => async (): Promise<LlmCallResult> => ({
      ok: true,
      text: JSON.stringify({ matches: [{ control_id: controlId, score: 80, reasoning: "r" }] }),
      inputTokens: 900,
      outputTokens: 90
    });

    await runControlMatcherWithOutcome(signal, seed.orgA.id, llmFor(controlsA[0].id));
    const b = await runControlMatcherWithOutcome(signal, seed.orgB.id, llmFor(controlB.id));

    // A cache HIT here would mean org B was served org A's analysis.
    expect(b.outcome).toBe("written");

    const bRows = await pool.query(
      `SELECT target_id FROM signal_match_suggestions WHERE organization_id = $1`,
      [seed.orgB.id]
    );
    expect(bRows.rowCount).toBe(1);
    expect(bRows.rows[0].target_id).toBe(controlB.id);
  });
});
