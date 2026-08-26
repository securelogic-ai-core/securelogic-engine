/**
 * verdictCacheMetrics.ts — hit rate, miss reason, savings, exhaustion, latency.
 *
 * Mirrors llmTelemetry's run-accumulator shape (begin → record → end) so the
 * Brief scheduler reports cache effectiveness beside its LLM spend, and the two
 * can be read together: `llm.by_purpose.llm_control_matcher` is what was PAID,
 * `verdict_cache` is what was AVOIDED.
 *
 * Savings are measured, not modelled. An `answered` row stores the tokens the
 * original call actually consumed, so a hit accumulates exactly those, priced
 * through the same table llmTelemetry uses — with the same discipline that an
 * unpriced model contributes to `unpriced_hits` rather than a fake $0 saving.
 */

import { logger } from "../../infra/logger.js";
import { estimateCostUsd } from "./llmTelemetry.js";
import type { VerdictMissReason } from "./verdictCachePolicy.js";

export type VerdictCacheTotals = {
  hits: number;
  misses: number;
  skips: number;
  miss_reasons: Record<string, number>;
  skip_reasons: Record<string, number>;
  tokens_saved: number;
  cost_saved_usd: number;
  unpriced_hits: number;
  retry_exhausted: number;
  lookup_ms: number;
  lookups: number;
};

export function emptyVerdictCacheTotals(): VerdictCacheTotals {
  return {
    hits: 0,
    misses: 0,
    skips: 0,
    miss_reasons: {},
    skip_reasons: {},
    tokens_saved: 0,
    cost_saved_usd: 0,
    unpriced_hits: 0,
    retry_exhausted: 0,
    lookup_ms: 0,
    lookups: 0
  };
}

let activeRun: VerdictCacheTotals | null = null;

export function beginVerdictCacheAccumulation(): void {
  if (activeRun) return;
  activeRun = emptyVerdictCacheTotals();
}

/**
 * True while an accumulation is in flight. Same hazard as
 * `isLlmRunAccumulating` — `begin…` no-ops when one is already active, so an
 * unconditional `end…` would steal another scope's totals.
 */
export function isVerdictCacheAccumulating(): boolean {
  return activeRun !== null;
}

export function endVerdictCacheAccumulation(): VerdictCacheTotals {
  const totals = activeRun ?? emptyVerdictCacheTotals();
  activeRun = null;
  return totals;
}

/** Test-only. */
export function resetVerdictCacheAccumulationForTest(): void {
  activeRun = null;
}

export type VerdictCacheEvent =
  | {
      kind: "hit";
      organizationId: string;
      model: string | null;
      inputTokens: number;
      outputTokens: number;
      lookupMs: number;
    }
  | { kind: "miss"; organizationId: string; reason: VerdictMissReason; lookupMs: number }
  | { kind: "skip"; organizationId: string; reason: string; lookupMs: number }
  | { kind: "retry_exhausted"; organizationId: string };

/** Record one cache event. Never throws — metrics are never load-bearing. */
export function recordVerdictCacheEvent(event: VerdictCacheEvent): void {
  try {
    if (event.kind === "retry_exhausted") {
      if (activeRun) activeRun.retry_exhausted += 1;
      return;
    }

    logger.info(
      {
        event: "llm_verdict_cache_lookup",
        outcome: event.kind,
        organizationId: event.organizationId,
        reason: event.kind === "hit" ? null : event.reason,
        lookup_ms: event.lookupMs
      },
      "LLM verdict cache lookup"
    );

    if (!activeRun) return;
    activeRun.lookups += 1;
    activeRun.lookup_ms += event.lookupMs;

    if (event.kind === "hit") {
      activeRun.hits += 1;
      activeRun.tokens_saved += event.inputTokens + event.outputTokens;
      const saved =
        event.model === null
          ? null
          : estimateCostUsd(event.model, {
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              cacheReadTokens: 0,
              cacheWriteTokens: 0
            });
      if (saved === null) {
        activeRun.unpriced_hits += 1;
      } else {
        activeRun.cost_saved_usd += saved;
      }
      return;
    }

    if (event.kind === "miss") {
      activeRun.misses += 1;
      activeRun.miss_reasons[event.reason] = (activeRun.miss_reasons[event.reason] ?? 0) + 1;
      return;
    }

    activeRun.skips += 1;
    activeRun.skip_reasons[event.reason] = (activeRun.skip_reasons[event.reason] ?? 0) + 1;
  } catch {
    // Never load-bearing.
  }
}
