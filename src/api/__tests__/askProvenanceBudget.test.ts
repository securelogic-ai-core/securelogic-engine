/**
 * askProvenanceBudget.test.ts — the provenance pass must fit the clock, or not
 * run at all.
 *
 * WHAT THIS LOCKS, and why it is not a refinement of 8621deec but the other
 * half of it. That commit gave the pass its own 4096-token budget and said the
 * two numbers were coupled: "raising this cap without raising the request
 * timeout trades a silent failure for a 504." Staging then proved BOTH walls
 * are real on the same turn:
 *
 *   - answers of 5939 / 7067 / 7091 / 7911 / 8275 chars ALL logged
 *     `ask_provenance_truncated` at 4096 — every long answer, uncited;
 *   - a long turn spent 59s of its 90s budget on orchestration alone, so the
 *     pass then ran past the deadline and the user got HTTP 504 at 90.0s while
 *     generation carried on behind them.
 *
 * A bigger cap cannot fix that: an 8275-char answer needs ~9300 tokens ≈ 104s,
 * and Cloudflare kills the origin at ~100s. So the pass is bounded by the clock
 * and returns null when it cannot finish — the SAME null the caller already
 * handles for a turn with no retrieval. An uncited answer, not a dead request.
 */

import { describe, expect, it } from "vitest";

import {
  provenanceBudgetFor,
  provenanceTokensNeededFor,
} from "../lib/ask/provenancePass.js";

describe("provenanceTokensNeededFor — cost scales with the answer", () => {
  it("asks for more than 4096 on every answer length that truncated on staging", () => {
    // The exact answerChars values logged with ask_provenance_truncated.
    for (const chars of [5939, 7067, 7091, 7911, 8275]) {
      expect(provenanceTokensNeededFor(chars)).toBeGreaterThan(4096);
    }
  });

  it("keeps a floor at the old fixed cap for short answers", () => {
    expect(provenanceTokensNeededFor(200)).toBe(4096);
  });

  it("is bounded — a runaway answer cannot request an unbounded budget", () => {
    expect(provenanceTokensNeededFor(10_000_000)).toBe(16_384);
  });
});

/**
 * The gate is a FLOOR, not a forecast.
 *
 * The previous contract converted remaining time into "affordable tokens" at a
 * hardcoded 89 tok/s and refused unless that covered the whole padded cap. On
 * staging 66204045 that refused a 7,135-char answer WITH 45.5 SECONDS LEFT —
 * logging "not enough time left in the request" while time was not the
 * constraint. Both constants in that comparison were unvalidated, because
 * nothing ever recorded what a pass actually cost.
 *
 * The prediction is gone. The deadline is real instead (passed to the SDK as a
 * request timeout, so an over-running pass is aborted rather than allowed to
 * 504), which is precisely what makes forecasting unnecessary.
 */
/**
 * The forecast is calibrated to a MEASUREMENT, not to an assumption.
 *
 * Staging a2a0f49e, 2026-08-14 22:09:40Z — the first pass that ever recorded
 * its own cost: `answerChars 1162 · outputTokens 3163 · elapsedMs 37106`.
 * That yields ~85 tok/s (the old 89 was close) and ~11x output tokens per
 * answer token (the old cap assumed 4x — less than half the true cost).
 *
 * An intermediate version of this file deleted the forecast entirely on the
 * theory that it was refusing work the clock had time for. Staging refuted it
 * immediately: two long answers ran and were cut off by their deadlines
 * (`ask_provenance_deadline_exceeded`, 8028 and 8927 chars), spending ~30s and
 * thousands of tokens to reach the same uncited answer. These cases exist so
 * that regression cannot recur.
 */
describe("provenanceBudgetFor — calibrated forecast, deadline as backstop", () => {
  it("predicts the measured cost of the one pass we have real numbers for", () => {
    // 1162 chars actually produced 3163 output tokens in 37.1s.
    const budget = provenanceBudgetFor(1162, 90_000);
    expect(budget.predictedTokens).toBeGreaterThan(2800);
    expect(budget.predictedTokens).toBeLessThan(3600);
    // And the cap must comfortably cover what was really emitted, or the
    // payload gets discarded whole.
    expect(budget.maxTokens).toBeGreaterThan(3163);
  });

  it("DECLINES the long answers that genuinely cannot finish — the ones that burned 30s", () => {
    // Both were cut off by their deadlines on staging after the forecast was
    // removed. They are not being cheated out of citations by a bad estimate;
    // ~11x at ~85 tok/s puts them minutes past any request budget.
    for (const [chars, msRemaining] of [
      [8028, 36_819],
      [8927, 41_275],
      [7135, 45_476],
      [8147, 35_697],
    ] as const) {
      const budget = provenanceBudgetFor(chars, msRemaining);
      expect(budget.viable, `${chars} chars with ${msRemaining}ms`).toBe(false);
      expect(budget.predictedTokens).toBeGreaterThan(budget.affordableTokens);
    }
  });

  it("runs a short answer when the budget is nearly untouched", () => {
    const budget = provenanceBudgetFor(1162, 80_000);
    expect(budget.viable).toBe(true);
    expect(budget.maxTokens).toBe(provenanceTokensNeededFor(1162));
  });

  it("compares like with like — predicted cost against affordable time", () => {
    // The defect this replaces: the old gate compared a PADDED CAP against
    // affordable time, so the safety headroom was charged twice and the log
    // then blamed the clock. Prediction and affordability are both token
    // counts now, and the cap is not part of the comparison.
    const budget = provenanceBudgetFor(1500, 60_000);
    expect(budget.maxTokens).toBeGreaterThan(budget.predictedTokens);
    expect(budget.viable).toBe(budget.affordableTokens >= budget.predictedTokens);
  });

  it("still declines outright once the request is effectively over", () => {
    expect(provenanceBudgetFor(200, 5_000).viable).toBe(false);
    expect(provenanceBudgetFor(200, 0).viable).toBe(false);
    expect(provenanceBudgetFor(200, -1_000).viable).toBe(false);
  });

  it("keeps the deadline strictly inside the time that remains", () => {
    // The backstop that makes an over-optimistic forecast survivable: finishing
    // the tokens is not the same as the response reaching the client.
    const ms = 60_000;
    const budget = provenanceBudgetFor(1000, ms);
    expect(budget.deadlineMs).toBeGreaterThan(0);
    expect(budget.deadlineMs).toBeLessThan(ms);
  });

  it("scales the deadline with the clock and the cap with the answer", () => {
    const short = provenanceBudgetFor(500, 50_000);
    const long = provenanceBudgetFor(9000, 50_000);
    expect(short.deadlineMs).toBe(long.deadlineMs);
    expect(long.maxTokens).toBeGreaterThan(short.maxTokens);
  });
});

/**
 * Background mode — the deferred path must not inherit the interactive limits
 * it was created to escape.
 *
 * This is not hypothetical tuning. The first staging run of async provenance
 * refused an 8,543-char answer with `ask_provenance_skipped_too_costly` inside
 * a five-minute worker budget, because the job was still being measured against
 * the interactive ceiling: predicted 23,496 tokens vs 20,400 affordable, and a
 * 16,384 output cap that would have truncated the payload even if it had run.
 */
describe("provenanceBudgetFor — background mode", () => {
  const BACKGROUND = { ceiling: 49_152 };
  const WORKER_MS = 12 * 60 * 1000;

  it("runs the exact answer the first deferred attempt refused", () => {
    const budget = provenanceBudgetFor(8543, WORKER_MS, BACKGROUND);
    expect(budget.viable).toBe(true);
    // And the cap must actually cover the predicted output, or the payload is
    // truncated and discarded whole — a silent way to fail after doing the work.
    expect(budget.maxTokens).toBeGreaterThanOrEqual(budget.predictedTokens);
  });

  it("would still refuse that answer under the interactive ceiling", () => {
    // The regression guard: this is the failure, reproduced.
    const interactive = provenanceBudgetFor(8543, WORKER_MS);
    expect(interactive.maxTokens).toBeLessThan(interactive.predictedTokens);
  });

  it("keeps the worker deadline inside the job visibility timeout", () => {
    // A job still running when its lock expires can be reclaimed and decomposed
    // twice. Harmless to correctness (the pending guard wins) but pure waste.
    const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
    expect(provenanceBudgetFor(8543, WORKER_MS, BACKGROUND).deadlineMs).toBeLessThan(
      LOCK_TIMEOUT_MS
    );
  });

  it("does not raise the interactive ceiling as a side effect", () => {
    // Background mode is opt-in. An interactive turn must be unaffected.
    expect(provenanceBudgetFor(8543, 60_000).maxTokens).toBeLessThanOrEqual(16_384);
  });
});
