/**
 * recurrenceDoesNotReopen.test.ts — ADR-0009, asserted so it cannot drift.
 *
 * THE RULING: a vulnerability reappearing does NOT reopen the canonical Finding.
 * Recurrence is preserved and surfaced at the OCCURRENCE level; reopening stays
 * an explicit, authorized human governance action.
 *
 * WHY A DEDICATED FILE. This is not a property of one function — it is a property
 * of the boundary between two subsystems, and boundaries erode one convenient
 * commit at a time. The tests below are deliberately structural as well as
 * behavioural: they assert that the recurrence modules do not even IMPORT the
 * finding-lifecycle machinery, because the cheapest way for this rule to die is
 * for someone to add "and also reopen the finding" to a reconciliation pass and
 * for every existing test to keep passing.
 *
 * The reason the ruling exists is in the code, not in anyone's preference:
 * findings.operational_status is DERIVED from decision_state, so an automatic
 * reopen would be the engine reversing a documented human decision made through
 * the closure gate — the same class of error SL-EXC-1 was created to fix.
 *
 * If a future package wants automatic reopen it must SUPERSEDE ADR-0009, not
 * quietly delete these assertions.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import {
  isClosureEligible,
  markRemediated,
  observe,
  type OccurrenceState,
} from "../lib/occurrenceLifecycle.js";
import { presenceFromObservations } from "../lib/observationReconciliation.js";

const T0 = "2026-08-01T00:00:00.000Z";
const T1 = "2026-08-20T00:00:00.000Z";

const absent = (): OccurrenceState => ({
  presence_status: "absent",
  first_seen_at: T0,
  last_seen_at: T0,
  absent_since: T0,
  remediated_at: null,
  reappeared_count: 0,
  last_reappeared_at: null,
});

describe("ADR-0009: recurrence is an occurrence fact, never a Finding transition", () => {
  it("observing a returned exposure yields ONLY presence fields", () => {
    const patch = observe(absent(), T1);
    const keys = Object.keys(patch);
    // Nothing here may name a Finding axis. If `decision_state` or
    // `operational_status` ever appears in this patch, the boundary is gone.
    expect(keys).not.toContain("decision_state");
    expect(keys).not.toContain("operational_status");
    expect(keys).not.toContain("status");
    expect(patch.presence_status).toBe("present");
    expect(patch.reappeared_count).toBe(1);
  });

  it("preserves the original first_seen_at across a recurrence", () => {
    // The exposure began when it began. Resetting it would erase the history the
    // ruling exists to preserve, and would restart any age-based reporting.
    const patch = observe(absent(), T1);
    expect(patch.first_seen_at).toBeUndefined();
  });

  it("presence derivation returns a PRESENCE, never a Finding state", () => {
    const d = presenceFromObservations("absent", [
      { id: "o1", occurrenceId: "occ1", sourceKey: "tenable", stale: false },
    ]);
    expect(["present", "absent", "remediated"]).toContain(d.next);
    expect(Object.keys(d)).toEqual(["next", "changed", "reason"]);
  });

  it("closure eligibility is ADVISORY — it reports, it does not act", () => {
    // Report-only by name and by contract (ERIP-AD-11). It returns a boolean for
    // a human to read; nothing in the engine consumes it to close anything.
    expect(isClosureEligible({ affected: 3, active: 0, absent: 3, remediated: 0, recurring: 1 }))
      .toBe(true);
    // And a finding with no occurrences is never eligible: absence of evidence
    // about exposure is not evidence of remediation.
    expect(isClosureEligible({ affected: 0, active: 0, absent: 0, remediated: 0, recurring: 0 }))
      .toBe(false);
  });

  it("a human's remediation is never overturned by a scanner going quiet", () => {
    const remediated: OccurrenceState = { ...absent(), presence_status: "remediated",
      absent_since: null, remediated_at: T0 };
    const d = presenceFromObservations("remediated", [
      { id: "o1", occurrenceId: "occ1", sourceKey: "tenable", stale: true },
    ]);
    expect(d.next).toBe("remediated");
    expect(d.changed).toBe(false);
    // markRemediated stays a human-driven transition producing only presence.
    expect(Object.keys(markRemediated(remediated, T1))).not.toContain("decision_state");
  });
});

describe("ADR-0009: the recurrence subsystem does not reach into finding lifecycle", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

  const RECURRENCE_MODULES = [
    "../lib/occurrenceLifecycle.ts",
    "../lib/observationReconciliation.ts",
    "../lib/vulnerabilityObservationStore.ts",
  ];

  it.each(RECURRENCE_MODULES)("%s does not import the finding lifecycle machinery", (mod) => {
    const src = read(mod);
    // The cheapest way for this rule to die is an import followed by one helpful
    // call. Refuse the import.
    expect(src).not.toMatch(/from\s+["'].*findingLifecycleMachine/);
    expect(src).not.toMatch(/from\s+["'].*findingClosureService/);
    expect(src).not.toMatch(/from\s+["'].*findingClosurePolicy/);
  });

  it.each(RECURRENCE_MODULES)("%s never writes a Finding status column", (mod) => {
    const src = read(mod);
    expect(src).not.toMatch(/UPDATE\s+findings/i);
    expect(src).not.toMatch(/decision_state\s*=/);
    expect(src).not.toMatch(/operational_status\s*=/);
  });

  it("the reconciliation store says out loud that it closes nothing", () => {
    const src = read("../lib/vulnerabilityObservationStore.ts");
    expect(src).toMatch(/NOT reopened automatically/);
    expect(src).toMatch(/no finding closed by the engine/i);
  });

  it("ADR-0009 exists and is ACCEPTED", () => {
    const adr = readFileSync(
      resolve(__dirname, "../../../docs/architecture/decisions/ADR-0009-recurrence-does-not-reopen-findings.md"),
      "utf8",
    );
    expect(adr).toMatch(/\*\*Status:\*\*\s*ACCEPTED/);
    expect(adr).toMatch(/does NOT reopen the canonical Finding/i);
  });
});
