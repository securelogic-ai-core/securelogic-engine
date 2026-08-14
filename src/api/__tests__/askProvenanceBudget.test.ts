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
describe("provenanceBudgetFor — a floor and a real deadline, not a forecast", () => {
  it("RUNS the long answers the old prediction refused, with time to spare", () => {
    // The two staging reproductions, at the time they actually had left.
    for (const [chars, msRemaining] of [
      [7135, 45_476],
      [8147, 35_697],
    ] as const) {
      const budget = provenanceBudgetFor(chars, msRemaining);
      expect(budget.viable, `${chars} chars with ${msRemaining}ms`).toBe(true);
    }
  });

  it("does not treat the padded cap as a time cost", () => {
    // The cap is a ceiling the model rarely reaches, sized for headroom so a
    // payload is not truncated and discarded. Charging the whole of it against
    // the clock is what produced the false refusals.
    const budget = provenanceBudgetFor(8275, 40_000);
    expect(budget.maxTokens).toBe(provenanceTokensNeededFor(8275));
    expect(budget.viable).toBe(true);
  });

  it("still declines when there is genuinely no time to come back in", () => {
    expect(provenanceBudgetFor(2000, 5_000).viable).toBe(false);
    expect(provenanceBudgetFor(2000, 0).viable).toBe(false);
    expect(provenanceBudgetFor(2000, -1_000).viable).toBe(false);
  });

  it("bounds the pass strictly inside the time that remains", () => {
    // Finishing the tokens is not the same as the response reaching the client:
    // the answer still has to be serialized and written after the pass returns
    // or is cut off, so the deadline must leave room.
    const ms = 60_000;
    const budget = provenanceBudgetFor(8275, ms);
    expect(budget.deadlineMs).toBeGreaterThan(0);
    expect(budget.deadlineMs).toBeLessThan(ms);
  });

  it("scales the deadline with the time left, not with the answer", () => {
    // Two very different answers, same clock — the deadline is a property of
    // the request budget. The answer only sizes the output cap.
    const short = provenanceBudgetFor(500, 50_000);
    const long = provenanceBudgetFor(9000, 50_000);
    expect(short.deadlineMs).toBe(long.deadlineMs);
    expect(long.maxTokens).toBeGreaterThan(short.maxTokens);
  });
});
