/**
 * verdictCache.test.ts — lookup / reservation / settlement, and the metrics
 * that make the cache's value measurable rather than asserted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: (_o: string, fn: () => Promise<unknown>) => fn(),
  requireTenantContext: vi.fn()
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import {
  lookupVerdict,
  reserveVerdict,
  recordAnsweredVerdict,
  recordFailedVerdict
} from "../lib/llm/verdictCache.js";
import {
  beginVerdictCacheAccumulation,
  endVerdictCacheAccumulation,
  resetVerdictCacheAccumulationForTest
} from "../lib/llm/verdictCacheMetrics.js";
import { VERDICT_RESERVATION_TIMEOUT_MS } from "../lib/llm/verdictCachePolicy.js";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const KEY = {
  organizationId: "org-1",
  signalDedupHash: "sha256:signal",
  controlInventoryDigest: "sha256:controls",
  promptVersion: "control-matcher-v1"
};
const NOW = new Date("2026-08-18T12:00:00Z");

const rows = (r: unknown[]) => ({ rows: r, rowCount: r.length }) as never;

describe("lookupVerdict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVerdictCacheAccumulationForTest();
  });

  it("returns a HIT for an answered verdict, with the tokens the original call cost", async () => {
    vi.mocked(pg.query).mockResolvedValueOnce(
      rows([
        {
          state: "answered",
          verdict: { matches: [{ control_id: "c1", score: 80, reasoning: "r" }] },
          input_tokens: 1200,
          output_tokens: 300,
          model: "claude-sonnet-4-6",
          attempts: 1,
          next_attempt_at: null,
          reserved_at: null
        }
      ])
    );

    const result = await lookupVerdict(KEY, NOW);

    expect(result).toMatchObject({ outcome: "hit", inputTokens: 1200, outputTokens: 300 });
    // A hit must not issue the miss-reason probe.
    expect(pg.query).toHaveBeenCalledTimes(1);
  });

  it("does NOT hit on an unparseable row — it is persisted but never reusable", async () => {
    vi.mocked(pg.query).mockResolvedValueOnce(
      rows([
        {
          state: "unparseable",
          verdict: null,
          input_tokens: null,
          output_tokens: null,
          model: null,
          attempts: 1,
          next_attempt_at: new Date(NOW.getTime() - 1000),
          reserved_at: null
        }
      ])
    );

    const result = await lookupVerdict(KEY, NOW);

    expect(result).toEqual({ outcome: "miss", reason: "non_reusable_state", attempts: 1 });
  });

  it("SKIPS a dead-lettered key — never reused, never silently 'no matches'", async () => {
    vi.mocked(pg.query).mockResolvedValueOnce(
      rows([
        {
          state: "dead_lettered",
          verdict: null,
          input_tokens: null,
          output_tokens: null,
          model: null,
          attempts: 3,
          next_attempt_at: null,
          reserved_at: null
        }
      ])
    );

    expect(await lookupVerdict(KEY, NOW)).toEqual({ outcome: "skip", reason: "dead_lettered" });
  });

  it("SKIPS while another process holds a live reservation", async () => {
    vi.mocked(pg.query).mockResolvedValueOnce(
      rows([
        {
          state: "pending",
          verdict: null,
          input_tokens: null,
          output_tokens: null,
          model: null,
          attempts: 1,
          next_attempt_at: null,
          reserved_at: new Date(NOW.getTime() - 60_000)
        }
      ])
    );

    expect(await lookupVerdict(KEY, NOW)).toEqual({ outcome: "skip", reason: "reserved_by_other" });
  });

  it("distinguishes 'never seen' from 'control inventory changed'", async () => {
    // No exact row; a row exists for the same signal under a different digest.
    vi.mocked(pg.query)
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(
        rows([{ control_inventory_digest: "sha256:OLD", prompt_version: "control-matcher-v1" }])
      );

    const result = await lookupVerdict(KEY, NOW);

    expect(result).toEqual({ outcome: "miss", reason: "control_inventory_changed", attempts: 0 });
  });

  it("reports a prompt-version bump as its own miss reason", async () => {
    vi.mocked(pg.query)
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(
        rows([{ control_inventory_digest: "sha256:controls", prompt_version: "control-matcher-v0" }])
      );

    expect(await lookupVerdict(KEY, NOW)).toMatchObject({ reason: "prompt_version_changed" });
  });

  it("reports a genuinely new signal as absent", async () => {
    vi.mocked(pg.query).mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([]));

    expect(await lookupVerdict(KEY, NOW)).toMatchObject({ reason: "absent" });
  });
});

describe("reserveVerdict — cross-process stampede control", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims when the insert/update wins", async () => {
    vi.mocked(pg.query).mockResolvedValueOnce(rows([{ attempts: 1 }]));
    expect(await reserveVerdict(KEY, NOW, VERDICT_RESERVATION_TIMEOUT_MS)).toEqual({
      claimed: true,
      attempts: 1
    });
  });

  it("does NOT claim when another process already holds the key", async () => {
    // ON CONFLICT DO NOTHING / guarded DO UPDATE returns no row.
    vi.mocked(pg.query).mockResolvedValueOnce(rows([]));
    expect(await reserveVerdict(KEY, NOW, VERDICT_RESERVATION_TIMEOUT_MS)).toEqual({
      claimed: false,
      attempts: 0
    });
  });

  it("never re-claims an answered or dead-lettered key, and consumes the budget per claim", async () => {
    vi.mocked(pg.query).mockResolvedValueOnce(rows([{ attempts: 2 }]));
    await reserveVerdict(KEY, NOW, VERDICT_RESERVATION_TIMEOUT_MS);

    const sql = vi.mocked(pg.query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("state NOT IN ('answered', 'dead_lettered')");
    expect(sql).toContain("attempts        = llm_control_matcher_verdicts.attempts + 1");
    expect(sql).toContain("ON CONFLICT");
  });
});

describe("settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVerdictCacheAccumulationForTest();
    vi.mocked(pg.query).mockResolvedValue(rows([]));
  });

  it("caches an EMPTY match list — 'no controls match' is a real answer worth keeping", async () => {
    await recordAnsweredVerdict(
      KEY,
      { matches: [] },
      { model: "claude-sonnet-4-6", inputTokens: 900, outputTokens: 20 },
      NOW
    );

    const [sql, params] = vi.mocked(pg.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("state = 'answered'");
    expect(params[4]).toBe(JSON.stringify({ matches: [] }));
    expect(params[6]).toBe(900);
  });

  it("stores diagnostics only for unparseable — no response body", async () => {
    await recordFailedVerdict(
      KEY,
      {
        state: "unparseable",
        parseErrorCode: "invalid_json",
        responseSha256: "sha256:abc",
        responseChars: 42,
        nextAttemptAt: new Date(NOW.getTime() + 60_000)
      },
      NOW
    );

    const [sql, params] = vi.mocked(pg.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("verdict = NULL");
    expect(params).toContain("invalid_json");
    expect(params).toContain("sha256:abc");
    // Nothing resembling response text is persisted.
    expect(params.filter((p) => typeof p === "string" && p.length > 100)).toHaveLength(0);
  });

  it("logs a LOUD, human-actionable event on dead-letter — never a silent suppression", async () => {
    await recordFailedVerdict(
      KEY,
      { state: "dead_lettered", failureClass: "transport", nextAttemptAt: null },
      NOW
    );

    const errorEvents = vi.mocked(logger.error).mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(errorEvents).toContain("llm_verdict_retry_exhausted");
  });
});

describe("metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVerdictCacheAccumulationForTest();
  });

  it("accumulates hit rate and MEASURED savings from the original call's tokens", async () => {
    beginVerdictCacheAccumulation();

    vi.mocked(pg.query).mockResolvedValueOnce(
      rows([
        {
          state: "answered",
          verdict: { matches: [] },
          input_tokens: 1_000_000,
          output_tokens: 0,
          model: "claude-sonnet-4-6",
          attempts: 1,
          next_attempt_at: null,
          reserved_at: null
        }
      ])
    );
    await lookupVerdict(KEY, NOW);

    vi.mocked(pg.query).mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([]));
    await lookupVerdict(KEY, NOW);

    const totals = endVerdictCacheAccumulation();

    expect(totals.hits).toBe(1);
    expect(totals.misses).toBe(1);
    expect(totals.miss_reasons["absent"]).toBe(1);
    expect(totals.tokens_saved).toBe(1_000_000);
    expect(totals.cost_saved_usd).toBeCloseTo(3.0, 4); // Sonnet 4.6 input rate
    expect(totals.lookups).toBe(2);
  });

  it("counts an unpriced hit rather than claiming a $0 saving", async () => {
    beginVerdictCacheAccumulation();
    vi.mocked(pg.query).mockResolvedValueOnce(
      rows([
        {
          state: "answered",
          verdict: { matches: [] },
          input_tokens: 500,
          output_tokens: 100,
          model: "model-we-do-not-price",
          attempts: 1,
          next_attempt_at: null,
          reserved_at: null
        }
      ])
    );
    await lookupVerdict(KEY, NOW);
    const totals = endVerdictCacheAccumulation();

    expect(totals.hits).toBe(1);
    expect(totals.unpriced_hits).toBe(1);
    expect(totals.cost_saved_usd).toBe(0);
    expect(totals.tokens_saved).toBe(600);
  });

  it("counts retry exhaustion", async () => {
    beginVerdictCacheAccumulation();
    vi.mocked(pg.query).mockResolvedValue(rows([]));
    await recordFailedVerdict(KEY, { state: "dead_lettered", nextAttemptAt: null }, NOW);
    expect(endVerdictCacheAccumulation().retry_exhausted).toBe(1);
  });
});
