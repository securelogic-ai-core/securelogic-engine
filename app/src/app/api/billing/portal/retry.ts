/**
 * Bounded transient-retry policy for the Stripe billing-portal engine call.
 *
 * Kept as a pure, dependency-free module (no next/server, no @/lib imports) so
 * the retry/backoff policy can be unit-tested in isolation. The route
 * (./route.ts) is the only place that wires this to createPortalSession + the
 * 303 redirects.
 *
 * Why retry at all: the first POST /api/billing/portal after the engine has
 * cold-restarted (Render redeploy + migrate) or after a stale keep-alive socket
 * can fail transiently — engineFetch aborts at 15s and createPortalSession maps
 * any thrown error to { error: "network_error" }. A single short retry was not
 * enough to absorb that window, bouncing the user to /account?billing_error and
 * requiring a second click. We retry ONLY this transient class; deterministic
 * configuration/auth errors (e.g. billing_not_configured, api_key_identity_missing)
 * are returned immediately so behaviour is unchanged for them.
 */

/** Engine error strings that are safe to retry (transient / network / timeout). */
export const TRANSIENT_PORTAL_ERRORS: ReadonlySet<string> = new Set([
  "network_error",
]);

/**
 * Backoff (ms) BEFORE each retry. Length = number of retries; total attempts =
 * backoffMs.length + 1. [1000, 3000] => up to 3 attempts, 4s of added backoff.
 * The dominant recoverable case (stale socket / fast connection reset) succeeds
 * on attempt 2 within ~1s; a deeply cold engine boot (beyond the attempt budget)
 * is better solved by an infra keep-warm and is intentionally out of scope here.
 */
export const PORTAL_RETRY_BACKOFF_MS: readonly number[] = [1000, 3000];

/** True only for transient results that should be retried. Success ({ url }) → false. */
export function isTransientPortalResult(result: { url?: string; error?: string }): boolean {
  return typeof result.error === "string" && TRANSIENT_PORTAL_ERRORS.has(result.error);
}

export interface RetryAttemptInfo<T> {
  /** Zero-based index of the attempt that just produced `result`. */
  attempt: number;
  result: T;
  /** Whether another attempt will follow this one. */
  willRetry: boolean;
}

export interface RetryOptions<T> {
  /** Delay before each retry; its length caps the number of retries. */
  backoffMs: readonly number[];
  /** Retry while this returns true for the latest result. */
  shouldRetry: (result: T) => boolean;
  /** Observe each attempt (for logging). Never throws into the loop. */
  onAttempt?: (info: RetryAttemptInfo<T>) => void;
  /** Injectable delay (tests pass a no-op to avoid real waits). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `op` up to (backoffMs.length + 1) times, retrying only while
 * `shouldRetry(result)` is true and attempts remain, pausing backoffMs[i]
 * before retry i. Returns the final result and the number of attempts made.
 *
 * `op` is expected to resolve (never reject) — createPortalSession already
 * catches and maps thrown errors to { error }. If `op` does reject, the
 * rejection propagates unchanged (no retry), matching prior route behaviour.
 */
export async function retryTransient<T>(
  op: (attempt: number) => Promise<T>,
  // NoInfer keeps T driven by `op`'s return type, not by the predicate/callback
  // param types (which would otherwise collapse T to the predicate's shape).
  opts: RetryOptions<NoInfer<T>>,
): Promise<{ result: T; attempts: number }> {
  const { backoffMs, shouldRetry, onAttempt } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let attempt = 0;
  let result = await op(attempt);

  while (shouldRetry(result) && attempt < backoffMs.length) {
    onAttempt?.({ attempt, result, willRetry: true });
    await sleep(backoffMs[attempt]!);
    attempt += 1;
    result = await op(attempt);
  }

  onAttempt?.({ attempt, result, willRetry: false });
  return { result, attempts: attempt + 1 };
}
