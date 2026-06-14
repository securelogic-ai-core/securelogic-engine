/**
 * dataRightsWorkerPolicy.test.ts — DB-free unit tests for the data-rights
 * worker's retry/backoff/dead-letter decision (PR #3).
 */

import { describe, expect, it } from "vitest";

import {
  EXPORT_JOB_TYPES,
  LOCK_TIMEOUT_MS,
  MAX_BACKOFF_MS,
  NonRetryableJobError,
  backoffMs,
  decideFailureState,
} from "../dataRightsWorkerPolicy.js";

describe("data-rights worker — scope constants", () => {
  it("claims only the two export job types (deletion + purge out of scope)", () => {
    expect([...EXPORT_JOB_TYPES]).toEqual(["data_export_self", "data_export_org"]);
    expect([...EXPORT_JOB_TYPES]).not.toContain("account_deletion_reap");
    expect([...EXPORT_JOB_TYPES]).not.toContain("export_file_purge");
  });

  it("uses a 15-minute visibility timeout", () => {
    expect(LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});

describe("backoffMs", () => {
  it("doubles per attempt starting at 1 minute", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(4)).toBe(480_000);
  });

  it("caps at MAX_BACKOFF_MS", () => {
    expect(backoffMs(100)).toBe(MAX_BACKOFF_MS);
  });

  it("never returns less than the 1-minute base (attempt 0/negative guarded)", () => {
    expect(backoffMs(0)).toBe(60_000);
    expect(backoffMs(-5)).toBe(60_000);
  });
});

describe("decideFailureState", () => {
  const now = new Date("2026-06-13T00:00:00.000Z");

  it("sends a NonRetryableJobError straight to 'failed' with no backoff", () => {
    const d = decideFailureState({ attempts: 1, max_attempts: 5 }, new NonRetryableJobError("bad payload"), now);
    expect(d.status).toBe("failed");
    expect(d.nextAttemptAt).toBeNull();
  });

  it("dead-letters once attempts reach max_attempts", () => {
    const d = decideFailureState({ attempts: 5, max_attempts: 5 }, new Error("transient"), now);
    expect(d.status).toBe("dead_lettered");
    expect(d.nextAttemptAt).toBeNull();
  });

  it("dead-letters when attempts somehow exceed max_attempts", () => {
    const d = decideFailureState({ attempts: 6, max_attempts: 5 }, new Error("transient"), now);
    expect(d.status).toBe("dead_lettered");
  });

  it("requeues a transient failure with exponential backoff while attempts remain", () => {
    const d = decideFailureState({ attempts: 2, max_attempts: 5 }, new Error("transient"), now);
    expect(d.status).toBe("queued");
    // attempts=2 → backoff 2m → next attempt 2 minutes from now.
    expect(d.nextAttemptAt?.toISOString()).toBe("2026-06-13T00:02:00.000Z");
  });

  it("non-retryable wins even when attempts remain", () => {
    const d = decideFailureState({ attempts: 1, max_attempts: 5 }, new NonRetryableJobError("nope"), now);
    expect(d.status).toBe("failed");
  });
});
