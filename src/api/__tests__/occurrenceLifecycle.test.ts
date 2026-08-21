/**
 * occurrenceLifecycle.test.ts — presence, and the lines it must not cross.
 *
 * The two assertions that matter most in this file are negative ones: absence is
 * never remediation, and nothing here ever closes a finding.
 */

import { describe, expect, it } from "vitest";

import {
  PRESENCE_STATUSES,
  hasRecurred,
  isClosureEligible,
  isNew,
  markAbsent,
  markRemediated,
  observe,
  type OccurrenceState,
} from "../lib/occurrenceLifecycle.js";

const T0 = "2026-08-01T00:00:00.000Z";
const T1 = "2026-08-10T00:00:00.000Z";
const T2 = "2026-08-20T00:00:00.000Z";

const state = (over: Partial<OccurrenceState> = {}): OccurrenceState => ({
  presence_status: "present",
  first_seen_at: T0,
  last_seen_at: T0,
  absent_since: null,
  remediated_at: null,
  reappeared_count: 0,
  last_reappeared_at: null,
  ...over,
});

describe("the presence vocabulary", () => {
  it("has exactly three states — NEW and REAPPEARED are derived, not stored", () => {
    expect([...PRESENCE_STATUSES]).toEqual(["present", "absent", "remediated"]);
  });

  it("NEW is derived from the seen window", () => {
    expect(isNew(state())).toBe(true);
    expect(isNew(state({ last_seen_at: T1 }))).toBe(false);
    // Seen once, gone, and back is not new — it has a history.
    expect(isNew(state({ reappeared_count: 1, last_reappeared_at: T1 }))).toBe(false);
  });

  it("RECURRING is derived from the counter", () => {
    expect(hasRecurred(state())).toBe(false);
    expect(hasRecurred(state({ reappeared_count: 2, last_reappeared_at: T1 }))).toBe(true);
  });
});

describe("observing an exposure", () => {
  it("advances last_seen_at and never moves first_seen_at", () => {
    const p = observe(state({ last_seen_at: T1 }), T2);
    expect(p.last_seen_at).toBe(T2);
    expect(p.first_seen_at).toBeUndefined();
    expect(p.presence_status).toBe("present");
  });

  it("is monotonic — a replayed or out-of-order observation cannot rewind", () => {
    // Reconciliation replay (SL-OCC-2) depends on this being idempotent.
    const p = observe(state({ last_seen_at: T2 }), T1);
    expect(p.last_seen_at).toBe(T2);
  });

  it("does not count a reappearance when it was already present", () => {
    const p = observe(state({ presence_status: "present" }), T1);
    expect(p.reappeared_count).toBeUndefined();
    expect(p.last_reappeared_at).toBeUndefined();
  });

  it("counts a reappearance from absent, preserving the original first_seen_at", () => {
    const s = state({ presence_status: "absent", absent_since: T1, last_seen_at: T1 });
    const p = observe(s, T2);
    expect(p.presence_status).toBe("present");
    expect(p.reappeared_count).toBe(1);
    expect(p.last_reappeared_at).toBe(T2);
    expect(p.absent_since).toBeNull();
    expect(p.first_seen_at).toBeUndefined(); // history is preserved
  });

  it("counts a reappearance from remediated — a fix that did not hold", () => {
    const s = state({ presence_status: "remediated", remediated_at: T1 });
    const p = observe(s, T2);
    expect(p.presence_status).toBe("present");
    expect(p.reappeared_count).toBe(1);
    expect(p.remediated_at).toBeNull();
  });
});

describe("absence is not remediation", () => {
  it("marks absent only from present", () => {
    const p = markAbsent(state(), T1);
    expect(p).toMatchObject({ presence_status: "absent", absent_since: T1 });
  });

  it("REFUSES to downgrade a remediated occurrence to absent", () => {
    // A human's claim about the work outranks a scanner's silence. Allowing this
    // would let an absence quietly overwrite a remediation record.
    expect(markAbsent(state({ presence_status: "remediated", remediated_at: T1 }), T2)).toBeNull();
  });

  it("is a no-op on an already-absent occurrence", () => {
    expect(markAbsent(state({ presence_status: "absent", absent_since: T1 }), T2)).toBeNull();
  });

  it("marking absent never sets remediated_at", () => {
    const p = markAbsent(state(), T1)!;
    expect(p.remediated_at).toBeUndefined();
  });

  it("marking remediated never sets absent_since", () => {
    const p = markRemediated(state(), T1);
    expect(p.presence_status).toBe("remediated");
    expect(p.remediated_at).toBe(T1);
    expect(p.absent_since).toBeNull();
  });
});

describe("closure eligibility is report-only", () => {
  const rollup = (over: Partial<Parameters<typeof isClosureEligible>[0]> = {}) => ({
    affected: 3, active: 0, absent: 2, remediated: 1, recurring: 0, ...over,
  });

  it("is eligible when no occurrence is still active", () => {
    expect(isClosureEligible(rollup())).toBe(true);
  });

  it("is NOT eligible while any occurrence remains active", () => {
    // One host still exposed keeps the whole finding live — this is the rule that
    // stops one asset's disappearance from closing a finding others still need.
    expect(isClosureEligible(rollup({ active: 1 }))).toBe(false);
  });

  it("a finding with NO occurrences is not eligible", () => {
    // Absence of evidence about exposure is not evidence of remediation. A
    // vulnerability recorded without any asset is a standing record, not a
    // finished one.
    expect(isClosureEligible(rollup({ affected: 0, active: 0, absent: 0, remediated: 0 }))).toBe(false);
  });

  it("all-absent (never remediated by anyone) is still only ELIGIBLE, not closed", () => {
    // The function's contract is advisory; nothing in the engine acts on it.
    expect(isClosureEligible(rollup({ absent: 3, remediated: 0 }))).toBe(true);
  });
});
