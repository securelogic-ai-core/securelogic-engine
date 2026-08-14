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

describe("provenanceBudgetFor — the clock is the binding constraint", () => {
  it("DECLINES the exact turn that 504'd: 8275 chars with ~30s left", () => {
    // Orchestration had already spent 59s of the 90s budget.
    const budget = provenanceBudgetFor(8275, 31_000);
    expect(budget.viable).toBe(false);
  });

  it("runs when the answer is short and the budget is nearly untouched", () => {
    const budget = provenanceBudgetFor(1500, 80_000);
    expect(budget.viable).toBe(true);
    expect(budget.maxTokens).toBe(provenanceTokensNeededFor(1500));
  });

  it("will NOT run on a partial budget — a truncated pass is discarded anyway", () => {
    // 40s affords ~2848 tokens; the answer needs ~9300. Running would hit the
    // cap, be thrown away whole, and spend the rest of the request doing it.
    const budget = provenanceBudgetFor(8275, 40_000);
    expect(budget.affordableTokens).toBe(2848);
    expect(budget.maxTokens).toBe(provenanceTokensNeededFor(8275));
    expect(budget.viable).toBe(false);
  });

  it("runs only once the time left covers the WHOLE decomposition", () => {
    const needed = provenanceTokensNeededFor(8275);
    const msJustEnough = Math.ceil((needed / (89 * 0.8)) * 1000) + 1000;
    expect(provenanceBudgetFor(8275, msJustEnough).viable).toBe(true);
  });

  it("declines outright once the request is effectively over", () => {
    expect(provenanceBudgetFor(2000, 5_000).viable).toBe(false);
    expect(provenanceBudgetFor(2000, 0).viable).toBe(false);
    expect(provenanceBudgetFor(2000, -1_000).viable).toBe(false);
  });

  it("leaves headroom — finishing the tokens is not reaching the client", () => {
    // A pass sized to exactly fill the remaining time would land ON the
    // deadline, which is the 504 this exists to prevent. So the time it is
    // allowed to spend is strictly less than the time that remains.
    const ms = 60_000;
    const budget = provenanceBudgetFor(1_000_000, ms);
    expect(budget.affordableTokens / 89).toBeLessThan(ms / 1000);
  });
});
