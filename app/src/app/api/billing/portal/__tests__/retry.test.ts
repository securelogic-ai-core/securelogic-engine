import { describe, it, expect, vi } from "vitest";
import {
  retryTransient,
  isTransientPortalResult,
  TRANSIENT_PORTAL_ERRORS,
  PORTAL_RETRY_BACKOFF_MS,
} from "../retry";

// Mirrors createPortalSession's return contract: { url } on success, { error } on failure.
type PortalResult = { url: string } | { error: string };

const ok: PortalResult = { url: "https://billing.stripe.com/p/session/test" };
const transient: PortalResult = { error: "network_error" };
const configError: PortalResult = { error: "billing_not_configured" };

/** A sleep stub that records delays and never actually waits. */
function fakeSleep() {
  const delays: number[] = [];
  const sleep = (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

/** Build an op that returns the given sequence of results across attempts. */
function sequenceOp(seq: PortalResult[]) {
  const op = vi.fn(async (attempt: number) => seq[Math.min(attempt, seq.length - 1)]!);
  return op;
}

describe("isTransientPortalResult", () => {
  it("treats only network_error as transient", () => {
    expect(isTransientPortalResult({ error: "network_error" })).toBe(true);
    expect(isTransientPortalResult({ error: "billing_not_configured" })).toBe(false);
    expect(isTransientPortalResult({ error: "api_key_identity_missing" })).toBe(false);
    expect(isTransientPortalResult({ error: "missing_portal_url" })).toBe(false);
  });

  it("treats a successful result (no error) as non-transient", () => {
    expect(isTransientPortalResult({} as { error?: string })).toBe(false);
  });

  it("the transient set is limited to network_error", () => {
    expect([...TRANSIENT_PORTAL_ERRORS]).toEqual(["network_error"]);
  });
});

describe("retryTransient — billing portal policy", () => {
  const policy = {
    backoffMs: PORTAL_RETRY_BACKOFF_MS,
    shouldRetry: isTransientPortalResult,
  };

  it("successful first attempt is unchanged (no retry, no backoff)", async () => {
    const { sleep, delays } = fakeSleep();
    const op = sequenceOp([ok]);

    const { result, attempts } = await retryTransient(op, { ...policy, sleep });

    expect(result).toEqual(ok);
    expect(attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]); // no waiting on the happy path
  });

  it("transient first failure then success → retries once and resolves", async () => {
    const { sleep, delays } = fakeSleep();
    const op = sequenceOp([transient, ok]);

    const { result, attempts } = await retryTransient(op, { ...policy, sleep });

    expect(result).toEqual(ok);
    expect(attempts).toBe(2);
    expect(op).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([PORTAL_RETRY_BACKOFF_MS[0]]); // one backoff before the retry
  });

  it("repeated transient failures exhaust the budget → final transient error", async () => {
    const { sleep, delays } = fakeSleep();
    const op = sequenceOp([transient, transient, transient, transient]);

    const { result, attempts } = await retryTransient(op, { ...policy, sleep });

    // The route turns this into the /account?billing_error=portal_failed redirect.
    expect(result).toEqual(transient);
    expect(attempts).toBe(PORTAL_RETRY_BACKOFF_MS.length + 1); // all attempts used
    expect(op).toHaveBeenCalledTimes(PORTAL_RETRY_BACKOFF_MS.length + 1);
    expect(delays).toEqual([...PORTAL_RETRY_BACKOFF_MS]); // backed off before every retry
  });

  it("non-transient (config/auth) error is NOT over-retried", async () => {
    const { sleep, delays } = fakeSleep();
    const op = sequenceOp([configError, ok]); // would succeed if retried — but must not retry

    const { result, attempts } = await retryTransient(op, { ...policy, sleep });

    expect(result).toEqual(configError);
    expect(attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("reports attempt transitions via onAttempt (retry vs final)", async () => {
    const { sleep } = fakeSleep();
    const op = sequenceOp([transient, ok]);
    const events: Array<{ attempt: number; willRetry: boolean }> = [];

    await retryTransient(op, {
      ...policy,
      sleep,
      onAttempt: ({ attempt, willRetry }) => events.push({ attempt, willRetry }),
    });

    expect(events).toEqual([
      { attempt: 0, willRetry: true }, // first (transient) failure → will retry
      { attempt: 1, willRetry: false }, // retry succeeded → terminal
    ]);
  });
});
