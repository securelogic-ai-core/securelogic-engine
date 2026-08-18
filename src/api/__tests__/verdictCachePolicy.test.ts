/**
 * verdictCachePolicy.test.ts — the DB-free decisions behind the verdict cache.
 *
 * These encode the operator's rulings of 2026-08-18, so a future edit that
 * violates one fails here rather than in production:
 *   - ONLY 'answered' is reusable; 'unparseable' is persisted but never a hit.
 *   - 3 attempts total (initial + 2 retries), exponential WITH jitter.
 *   - Exhaustion dead-letters visibly and is never auto-retried — and is never
 *     a cached negative verdict.
 *   - Control changes invalidate by KEY MISS (the digest changes), not by an
 *     invalidation job.
 */

import { describe, it, expect } from "vitest";
import {
  isReusable,
  isRetryableNow,
  decideVerdictFailureState,
  verdictBackoffMs,
  controlInventoryDigest,
  responseFingerprint,
  VERDICT_MAX_ATTEMPTS,
  VERDICT_MAX_BACKOFF_MS,
  VERDICT_RESERVATION_TIMEOUT_MS
} from "../lib/llm/verdictCachePolicy.js";

const NOW = new Date("2026-08-18T12:00:00Z");

describe("reusability — only an answered verdict is a hit", () => {
  it("answered is reusable", () => {
    expect(isReusable("answered")).toBe(true);
  });

  it("unparseable is NOT reusable (operator ruling) even though it is persisted", () => {
    expect(isReusable("unparseable")).toBe(false);
  });

  it("failed, pending and dead_lettered are not reusable", () => {
    expect(isReusable("failed")).toBe(false);
    expect(isReusable("pending")).toBe(false);
    expect(isReusable("dead_lettered")).toBe(false);
  });
});

describe("retry budget", () => {
  it("is 3 attempts total — the initial call plus two retries", () => {
    expect(VERDICT_MAX_ATTEMPTS).toBe(3);
  });

  it("keeps transport and unparseable failures in SEPARATE states while retries remain", () => {
    expect(decideVerdictFailureState("transport", 1, NOW).state).toBe("failed");
    expect(decideVerdictFailureState("unparseable", 1, NOW).state).toBe("unparseable");
  });

  it("dead-letters at the budget, for BOTH failure kinds", () => {
    expect(decideVerdictFailureState("transport", 3, NOW)).toEqual({
      state: "dead_lettered",
      nextAttemptAt: null
    });
    expect(decideVerdictFailureState("unparseable", 3, NOW)).toEqual({
      state: "dead_lettered",
      nextAttemptAt: null
    });
  });

  it("schedules a backoff while retries remain, and none once dead-lettered", () => {
    expect(decideVerdictFailureState("transport", 1, NOW).nextAttemptAt).toBeInstanceOf(Date);
    expect(decideVerdictFailureState("transport", 2, NOW).nextAttemptAt).toBeInstanceOf(Date);
    expect(decideVerdictFailureState("transport", 3, NOW).nextAttemptAt).toBeNull();
  });
});

describe("backoff", () => {
  it("grows exponentially between attempts", () => {
    const mid = () => 0.5; // fixed jitter for comparison
    expect(verdictBackoffMs(2, mid)).toBeGreaterThan(verdictBackoffMs(1, mid));
    expect(verdictBackoffMs(3, mid)).toBeGreaterThan(verdictBackoffMs(2, mid));
  });

  it("applies jitter — identical attempts do not produce identical delays", () => {
    // After an outage, thousands of rows become retry-eligible at once;
    // lockstep retries would be the outage's own echo.
    expect(verdictBackoffMs(1, () => 0.0)).not.toBe(verdictBackoffMs(1, () => 0.99));
  });

  it("is capped", () => {
    expect(verdictBackoffMs(50, () => 0.99)).toBeLessThanOrEqual(VERDICT_MAX_BACKOFF_MS);
  });
});

describe("isRetryableNow", () => {
  const base = { next_attempt_at: null, reserved_at: null } as const;

  it("never retries an answered or dead_lettered row", () => {
    expect(isRetryableNow({ ...base, state: "answered" }, NOW)).toBe(false);
    expect(isRetryableNow({ ...base, state: "dead_lettered" }, NOW)).toBe(false);
  });

  it("treats a FRESH reservation as held by another process", () => {
    const reserved = new Date(NOW.getTime() - 60_000);
    expect(isRetryableNow({ ...base, state: "pending", reserved_at: reserved }, NOW)).toBe(false);
  });

  it("reclaims a STALE reservation — a crashed winner must not strand the key forever", () => {
    const stale = new Date(NOW.getTime() - VERDICT_RESERVATION_TIMEOUT_MS - 1000);
    expect(isRetryableNow({ ...base, state: "pending", reserved_at: stale }, NOW)).toBe(true);
  });

  it("honours the backoff on failed/unparseable rows", () => {
    const later = new Date(NOW.getTime() + 60_000);
    const earlier = new Date(NOW.getTime() - 60_000);
    expect(isRetryableNow({ ...base, state: "failed", next_attempt_at: later }, NOW)).toBe(false);
    expect(isRetryableNow({ ...base, state: "failed", next_attempt_at: earlier }, NOW)).toBe(true);
    expect(isRetryableNow({ ...base, state: "unparseable", next_attempt_at: earlier }, NOW)).toBe(true);
  });
});

describe("controlInventoryDigest — invalidation by key miss", () => {
  const controls = [
    { id: "c1", name: "Access Control", description: "Least privilege" },
    { id: "c2", name: "Encryption", description: "At rest" }
  ];

  it("is stable for the same inventory", () => {
    expect(controlInventoryDigest(controls)).toBe(controlInventoryDigest([...controls]));
  });

  it("CHANGES when a control is added, removed, renamed, or re-described", () => {
    const original = controlInventoryDigest(controls);
    expect(controlInventoryDigest([...controls, { id: "c3", name: "Backup", description: "Daily" }])).not.toBe(original);
    expect(controlInventoryDigest([controls[0]!])).not.toBe(original);
    expect(controlInventoryDigest([{ ...controls[0]!, name: "Access Controls" }, controls[1]!])).not.toBe(original);
    expect(controlInventoryDigest([{ ...controls[0]!, description: "Changed" }, controls[1]!])).not.toBe(original);
  });

  it("changes with ORDER, because the prompt is order-sensitive", () => {
    expect(controlInventoryDigest([controls[1]!, controls[0]!])).not.toBe(
      controlInventoryDigest(controls)
    );
  });

  it("cannot be collided by concatenation (length-prefixed fields)", () => {
    expect(controlInventoryDigest([{ id: "ab", name: "c", description: "" }])).not.toBe(
      controlInventoryDigest([{ id: "a", name: "bc", description: "" }])
    );
  });

  it("is one-way — control names and descriptions are never recoverable from it", () => {
    const digest = controlInventoryDigest(controls);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digest).not.toContain("Access Control");
    expect(digest).not.toContain("Least privilege");
  });

  it("treats a null description the same as an empty one", () => {
    expect(controlInventoryDigest([{ id: "c1", name: "n", description: null }])).toBe(
      controlInventoryDigest([{ id: "c1", name: "n", description: "" }])
    );
  });
});

describe("responseFingerprint — grouping without retention", () => {
  it("groups identical malformed responses and retains no content", () => {
    const a = responseFingerprint("{{ broken json");
    const b = responseFingerprint("{{ broken json");
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toContain("broken");
    expect(a.chars).toBe("{{ broken json".length);
  });

  it("separates different malformed shapes", () => {
    expect(responseFingerprint("one").sha256).not.toBe(responseFingerprint("two").sha256);
  });
});
