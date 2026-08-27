/**
 * outOfProcessTelemetry.test.ts — "zero" and "not measured here" must never be
 * the same value.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * The Wave 4 Tier 2 gate (#826) was handed a Brief-scheduler run summary
 * carrying `verdict_cache: {hits: 0, misses: 0, lookups: 0, tokens_saved: 0}`
 * for a run during which the matcher worker performed real verdict-cache
 * lookups in ANOTHER PROCESS. The numbers were not wrong so much as
 * unauthorised: the scheduler was answering a question it has no way to
 * observe, and the answer read as evidence of an idle cache.
 *
 * The same shape hid a second claim: `llm.by_purpose` has carried no
 * `llm_control_matcher` bucket since Wave 4 moved matching off this process, so
 * a reader summing the scheduler's `llm` totals concludes the matcher cost
 * nothing.
 *
 * These tests pin the correction:
 *   NEVER A FALSE ZERO  — the scheduler cannot publish numeric verdict-cache
 *                         totals at all; the field is a semantic marker.
 *   STILL DISTINGUISHES — a genuinely measured zero remains numerically zero
 *                         and is NOT reported as unmeasured.
 *   SELF-DESCRIBING     — the marker names the producer and the event that
 *                         carry the real figures, so the reader's next step is
 *                         not a guess.
 */

import { describe, it, expect } from "vitest";

import {
  NOT_MEASURED_IN_THIS_PROCESS,
  notMeasuredInThisProcess,
  isNotMeasuredInThisProcess
} from "../lib/llm/outOfProcessMetric.js";
import { emptyVerdictCacheTotals } from "../lib/llm/verdictCacheMetrics.js";
import { emptyLlmRunTotals } from "../lib/llm/llmTelemetry.js";

describe("out-of-process metric marker", () => {
  const marker = notMeasuredInThisProcess(
    "securelogic-intelligence-worker",
    "control_matcher_tick_complete",
    "the matcher runs in another process"
  );

  it("is recognisable without knowing the process topology", () => {
    expect(isNotMeasuredInThisProcess(marker)).toBe(true);
    expect(marker.measurement).toBe(NOT_MEASURED_IN_THIS_PROCESS);
  });

  it("names the producer and the event that carry the real numbers", () => {
    // The whole point of the marker is that it is actionable. A bare "unknown"
    // would have left the #826 analysis exactly as stuck as a false zero did.
    expect(marker.producer).toBe("securelogic-intelligence-worker");
    expect(marker.event).toBe("control_matcher_tick_complete");
    expect(marker.reason).toBeTruthy();
  });

  it("carries no numeric fields that could be summed by mistake", () => {
    // A consumer that blindly does `totals.hits + …` must fail loudly on this
    // value rather than silently contribute 0 to a dashboard.
    for (const value of Object.values(marker)) {
      expect(typeof value).not.toBe("number");
    }
    expect(marker).not.toHaveProperty("hits");
    expect(marker).not.toHaveProperty("lookups");
    expect(marker).not.toHaveProperty("tokens_saved");
    expect(marker).not.toHaveProperty("cost_usd");
  });

  it("does NOT classify a genuinely measured zero as unmeasured", () => {
    // The failure mode this suite guards runs in both directions. A worker tick
    // that really did zero lookups must stay numerically zero — otherwise
    // "measured, and nothing happened" becomes unreportable.
    const measuredZeroCache = emptyVerdictCacheTotals();
    const measuredZeroLlm = emptyLlmRunTotals();

    expect(isNotMeasuredInThisProcess(measuredZeroCache)).toBe(false);
    expect(isNotMeasuredInThisProcess(measuredZeroLlm)).toBe(false);
    expect(measuredZeroCache.lookups).toBe(0);
    expect(measuredZeroLlm.calls).toBe(0);
  });

  it("treats null and undefined as not-a-marker", () => {
    expect(isNotMeasuredInThisProcess(null)).toBe(false);
    expect(isNotMeasuredInThisProcess(undefined)).toBe(false);
    expect(isNotMeasuredInThisProcess({})).toBe(false);
    expect(isNotMeasuredInThisProcess({ measurement: "something else" })).toBe(false);
  });
});
