/**
 * verdictCachePolicy.ts — DB-free policy for the LLM control-matcher verdict
 * cache.
 *
 * Split from the DB-touching module for the same reason
 * dataRightsWorkerPolicy.ts is: infra/postgres throws at module-eval when
 * DATABASE_URL is unset, so every decision worth unit-testing lives here with
 * no database import.
 *
 * Design: docs/investigation/llm-verdict-cache-design.md + …-addendum.md.
 * Operator rulings (2026-08-18) encoded here:
 *   - ONLY 'answered' is reusable. 'unparseable' is persisted for observability
 *     and never satisfies a lookup.
 *   - 'unparseable' and 'failed' are both retryable, with SEPARATE state so the
 *     two failure modes never blur into one "error".
 *   - Retry budget is 3 attempts total (initial + 2), exponential with jitter.
 *   - Exhaustion dead-letters visibly; it is never a cached negative verdict.
 */

import { createHash } from "node:crypto";

/** Total attempts before dead-lettering: the initial call plus two retries. */
export const VERDICT_MAX_ATTEMPTS = 3;

/** Base backoff; attempt 1 → ~1 min, attempt 2 → ~2 min, capped below. */
const BASE_BACKOFF_MS = 60_000;
export const VERDICT_MAX_BACKOFF_MS = 30 * 60 * 1000;

/**
 * A 'pending' reservation older than this is presumed abandoned (the reserving
 * process died mid-call) and may be re-claimed.
 *
 * Without reclamation a crashed winner would strand its key in 'pending'
 * forever — the same orphan-state class this program just spent a package
 * eliminating for signals and briefs. It is not being reintroduced here.
 */
export const VERDICT_RESERVATION_TIMEOUT_MS = 15 * 60 * 1000;

export type VerdictState =
  | "pending"
  | "answered"
  | "unparseable"
  | "failed"
  | "dead_lettered";

/**
 * Why a lookup did not produce a reusable verdict. Distinguishing these is the
 * point: "we had never seen this signal" and "control churn invalidated a
 * verdict we already paid for" lead to different decisions.
 */
export type VerdictMissReason =
  | "absent"
  | "control_inventory_changed"
  | "prompt_version_changed"
  | "non_reusable_state"
  | "reserved_by_other";

/**
 * Exponential backoff with jitter, for a 1-based attempt count.
 *
 * Jitter matters here in a way it does not for the export worker's one-job-
 * per-request retries: after a provider outage, thousands of verdict rows
 * become retry-eligible simultaneously. Deterministic backoff would march them
 * back into the provider in lockstep — the outage's own echo. `random` is
 * injectable so tests are deterministic.
 */
export function verdictBackoffMs(attempts: number, random: () => number = Math.random): number {
  const exp = Math.max(0, attempts - 1);
  const base = Math.min(BASE_BACKOFF_MS * 2 ** exp, VERDICT_MAX_BACKOFF_MS);
  // Full jitter over [0.5, 1.5) x base, still capped.
  const jittered = base * (0.5 + random());
  return Math.min(Math.round(jittered), VERDICT_MAX_BACKOFF_MS);
}

/** Only an answered verdict may satisfy a lookup. Ruling 1, in one place. */
export function isReusable(state: VerdictState): boolean {
  return state === "answered";
}

/**
 * Terminal-state decision after a failed attempt.
 *
 * `attempts` is the count AFTER this attempt. Both failure kinds share the
 * budget but keep their own state, so telemetry can separate a provider outage
 * from a prompt/parse defect.
 */
export function decideVerdictFailureState(
  kind: "transport" | "unparseable",
  attempts: number,
  now: Date,
  random: () => number = Math.random
): { state: VerdictState; nextAttemptAt: Date | null } {
  if (attempts >= VERDICT_MAX_ATTEMPTS) {
    // Visible and human-actionable. NOT a cached "no suggestions".
    return { state: "dead_lettered", nextAttemptAt: null };
  }
  return {
    state: kind === "transport" ? "failed" : "unparseable",
    nextAttemptAt: new Date(now.getTime() + verdictBackoffMs(attempts, random))
  };
}

/**
 * Is a non-reusable row eligible to be retried now?
 *
 * dead_lettered is never auto-retried (it needs a human); pending is retried
 * only once its reservation has gone stale.
 */
export function isRetryableNow(
  row: { state: VerdictState; next_attempt_at: Date | null; reserved_at: Date | null },
  now: Date
): boolean {
  if (row.state === "answered" || row.state === "dead_lettered") return false;
  if (row.state === "pending") {
    if (!row.reserved_at) return true;
    return now.getTime() - row.reserved_at.getTime() >= VERDICT_RESERVATION_TIMEOUT_MS;
  }
  // failed / unparseable: honour the backoff.
  if (!row.next_attempt_at) return true;
  return now.getTime() >= row.next_attempt_at.getTime();
}

/**
 * Digest of the org's control inventory EXACTLY as the prompt sees it.
 *
 * Must be computed from the same projection, in the same order, that
 * buildControlMatcherPrompt receives — that is what makes "the digest changes
 * precisely when the prompt would" true, and therefore what makes key-miss
 * invalidation correct without any invalidation job.
 *
 * The digest is one-way: control names and descriptions are hashed, never
 * stored, which keeps the row content-free (see the migration's PAYLOAD note).
 */
export function controlInventoryDigest(
  controls: ReadonlyArray<{ id: string; name: string; description?: string | null }>
): string {
  const hash = createHash("sha256");
  for (const c of controls) {
    // Length-prefixed so no combination of values can collide by concatenation.
    for (const part of [c.id, c.name, c.description ?? ""]) {
      hash.update(String(part.length));
      hash.update(":");
      hash.update(part);
      hash.update("|");
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Content-free fingerprint of a malformed response, for grouping without retention. */
export function responseFingerprint(text: string): { sha256: string; chars: number } {
  return {
    sha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    chars: text.length
  };
}

/** Classify a transport failure for telemetry, without retaining the message. */
export function classifyTransportFailure(code: string | undefined): string {
  if (!code) return "other";
  if (code.includes("unavailable")) return "unavailable";
  if (code.includes("failed")) return "transport";
  return code;
}
