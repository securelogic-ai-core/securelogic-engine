/**
 * llmTelemetry.ts — token / cost / latency measurement for every Anthropic call.
 *
 * WHY
 * ---
 * Before this module, provider spend was completely uninstrumented: the SDK
 * wrapper (providerQuotaAlert.instrumentAnthropicClient) observed only the
 * THROW path — 429s and credit exhaustion — and never read `message.usage` on
 * success. Call VOLUME could be reconstructed only by counting `llm_call_start`
 * log lines, and cost could not be reconstructed at all. Every claim about the
 * weekly Brief run's cost was therefore unfalsifiable, which is why this lands
 * BEFORE any optimization work: an optimization you cannot measure is a story.
 *
 * WHAT
 * ----
 * 1. `recordLlmUsage` — one structured `llm_call_usage` event per call, with
 *    tokens, latency, model, estimated cost, and attribution.
 * 2. Attribution via AsyncLocalStorage: call sites wrap their work in
 *    `withLlmCallContext({ purpose, organizationId }, fn)` and the SDK wrapper
 *    — which sees only `messages.create(params)` and has no idea who called it
 *    — recovers that context. ALS propagates correctly across awaits and
 *    concurrent branches, so parallel enrichment calls keep their own context.
 * 3. A run-scoped accumulator (`beginLlmRunAccumulation` / `end…`) so
 *    `runScheduler()` can report per-run totals in its summary. Runs are
 *    serialized by schedulerRunner's lock, so a module-level accumulator is
 *    safe; a second `begin` while one is active is ignored rather than
 *    clobbering the first.
 *
 * COST IS AN ESTIMATE, AND NEVER SILENTLY ZERO
 * --------------------------------------------
 * Prices are list rates per million tokens, hard-coded per model id. An
 * UNKNOWN model yields `costUsd: null`, never 0 — and the accumulator counts
 * those calls in `unpriced_calls` so a totals line can never read "$0.00" when
 * the truth is "we do not know". Cache reads bill at ~0.1x input and cache
 * writes at ~1.25x input; both are included when the SDK reports them.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../../infra/logger.js";

// ---------------------------------------------------------------------------
// Attribution context
// ---------------------------------------------------------------------------

export type LlmCallContext = {
  /** Stable label for the call site, e.g. "brief_item_enrichment". */
  purpose: string;
  /** Owning org, or null for genuinely org-less work. */
  organizationId: string | null;
};

const contextStore = new AsyncLocalStorage<LlmCallContext>();

/**
 * Run `fn` with LLM-call attribution attached. Every Anthropic call made
 * inside (including inside awaits and concurrent branches) is recorded against
 * this purpose/org.
 */
export function withLlmCallContext<T>(context: LlmCallContext, fn: () => T): T {
  return contextStore.run(context, fn);
}

/** The active attribution context, or undefined outside any wrapped scope. */
export function currentLlmCallContext(): LlmCallContext | undefined {
  return contextStore.getStore();
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * List price in USD per MILLION tokens, by exact model id.
 *
 * Keep this table in sync with Anthropic's published pricing. An id absent
 * here is not an error — it produces a null cost and increments the
 * accumulator's `unpriced_calls`, which is the honest answer.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10.0, output: 50.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 }
};

/** Cache reads bill at ~0.1x the input rate; cache writes at ~1.25x. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Estimated USD cost for one call, or null when the model has no price entry.
 * Null means "unknown", never "free" — callers must not coerce it to 0.
 */
export function estimateCostUsd(model: string, tokens: TokenCounts): number | null {
  const price = PRICE_PER_MTOK[model];
  if (!price) return null;

  const perToken = (rate: number): number => rate / 1_000_000;

  return (
    tokens.inputTokens * perToken(price.input) +
    tokens.outputTokens * perToken(price.output) +
    tokens.cacheReadTokens * perToken(price.input) * CACHE_READ_MULTIPLIER +
    tokens.cacheWriteTokens * perToken(price.input) * CACHE_WRITE_MULTIPLIER
  );
}

/** Exposed so a test can assert the table covers every model the code calls. */
export function isModelPriced(model: string): boolean {
  return model in PRICE_PER_MTOK;
}

// ---------------------------------------------------------------------------
// Run accumulator
// ---------------------------------------------------------------------------

export type LlmPurposeTotals = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number;
  cost_usd: number;
  unpriced_calls: number;
  failed_calls: number;
};

export type LlmRunTotals = LlmPurposeTotals & {
  by_purpose: Record<string, LlmPurposeTotals>;
};

const emptyTotals = (): LlmPurposeTotals => ({
  calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  latency_ms: 0,
  cost_usd: 0,
  unpriced_calls: 0,
  failed_calls: 0
});

/** A zeroed totals object — the honest value for a run that made no calls. */
export function emptyLlmRunTotals(): LlmRunTotals {
  return { ...emptyTotals(), by_purpose: {} };
}

let activeRun: LlmRunTotals | null = null;

/**
 * Start accumulating per-run totals. Idempotent-safe: a second call while an
 * accumulation is active is a no-op, so a nested/overlapping caller cannot
 * silently discard the outer run's numbers.
 */
export function beginLlmRunAccumulation(): void {
  if (activeRun) return;
  activeRun = { ...emptyTotals(), by_purpose: {} };
}

/**
 * True while an accumulation is in flight.
 *
 * `beginLlmRunAccumulation` is a silent no-op when one is already active, so a
 * caller that begins/ends unconditionally can END SOMEONE ELSE'S accumulation
 * and report their totals as its own. Callers that own a nested scope check
 * this first and only close what they actually opened.
 */
export function isLlmRunAccumulating(): boolean {
  return activeRun !== null;
}

/** Stop accumulating and return the totals (all zeros if never started). */
export function endLlmRunAccumulation(): LlmRunTotals {
  const totals = activeRun ?? { ...emptyTotals(), by_purpose: {} };
  activeRun = null;
  return totals;
}

/** Test-only: drop any in-flight accumulation. */
export function resetLlmRunAccumulationForTest(): void {
  activeRun = null;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export type LlmUsageRecord = {
  model: string;
  tokens: TokenCounts;
  latencyMs: number;
  /** False when the call threw — tokens are unknown, latency still counts. */
  ok: boolean;
};

function addTo(target: LlmPurposeTotals, record: LlmUsageRecord, costUsd: number | null): void {
  target.calls += 1;
  target.input_tokens += record.tokens.inputTokens;
  target.output_tokens += record.tokens.outputTokens;
  target.cache_read_tokens += record.tokens.cacheReadTokens;
  target.cache_write_tokens += record.tokens.cacheWriteTokens;
  target.latency_ms += record.latencyMs;
  if (costUsd === null) {
    target.unpriced_calls += 1;
  } else {
    target.cost_usd += costUsd;
  }
  if (!record.ok) target.failed_calls += 1;
}

/**
 * Record one Anthropic call: emit `llm_call_usage` and fold it into the active
 * run accumulator (if any). Never throws — telemetry must not be able to break
 * the call path it observes.
 */
export function recordLlmUsage(record: LlmUsageRecord): void {
  try {
    const context = currentLlmCallContext();
    const purpose = context?.purpose ?? "unattributed";
    const costUsd = record.ok ? estimateCostUsd(record.model, record.tokens) : null;

    logger.info(
      {
        event: "llm_call_usage",
        purpose,
        organizationId: context?.organizationId ?? null,
        model: record.model,
        ok: record.ok,
        input_tokens: record.tokens.inputTokens,
        output_tokens: record.tokens.outputTokens,
        cache_read_tokens: record.tokens.cacheReadTokens,
        cache_write_tokens: record.tokens.cacheWriteTokens,
        latency_ms: record.latencyMs,
        cost_usd: costUsd
      },
      "LLM call usage"
    );

    if (!activeRun) return;
    addTo(activeRun, record, costUsd);
    const bucket = (activeRun.by_purpose[purpose] ??= emptyTotals());
    addTo(bucket, record, costUsd);
  } catch {
    // Telemetry is never load-bearing.
  }
}
