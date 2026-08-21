/**
 * observationReconciliation.test.ts — the rule that must never be got wrong.
 *
 * Almost every test here asserts that something does NOT happen. That is the
 * point: the dangerous failure of a vulnerability product is not missing an
 * exposure, it is confidently reporting one as gone. These are the guards.
 */

import { describe, expect, it } from "vitest";

import {
  absenceAuthority,
  observationsToStale,
  presenceFromObservations,
  type Observation,
  type ScanRun,
} from "../lib/observationReconciliation.js";

const run = (over: Partial<ScanRun> = {}): ScanRun => ({
  id: "run-1",
  sourceKey: "tenable",
  status: "completed",
  scopeDeclared: true,
  reconciledAt: null,
  ...over,
});

const obs = (over: Partial<Observation & { assetId: string }> = {}) => ({
  id: "o-1",
  occurrenceId: "occ-1",
  sourceKey: "tenable",
  stale: false,
  assetId: "asset-1",
  ...over,
});

describe("who may say 'absent'", () => {
  it("a completed, scope-declared run may", () => {
    expect(absenceAuthority(run())).toEqual({ authorised: true });
  });

  it("an ABORTED run may not — it proves nothing about what it never reached", () => {
    const a = absenceAuthority(run({ status: "aborted" }));
    expect(a.authorised).toBe(false);
    if (!a.authorised) expect(a.reason).toMatch(/did not finish/i);
  });

  it("an unfinished run may not", () => {
    expect(absenceAuthority(run({ status: "in_progress" })).authorised).toBe(false);
  });

  it("a run that did not declare its SCOPE may not", () => {
    // It told us what it FOUND, not what it LOOKED AT. Its silence is not evidence.
    const a = absenceAuthority(run({ scopeDeclared: false }));
    expect(a.authorised).toBe(false);
    if (!a.authorised) expect(a.reason).toMatch(/LOOKED AT/i);
  });

  it("an already-reconciled run may not — replay must change nothing", () => {
    const a = absenceAuthority(run({ reconciledAt: "2026-08-20T00:00:00.000Z" }));
    expect(a.authorised).toBe(false);
    if (!a.authorised) expect(a.reason).toMatch(/already been reconciled/i);
  });

  it("always explains itself rather than returning a bare false", () => {
    for (const r of [
      run({ status: "aborted" }),
      run({ scopeDeclared: false }),
      run({ reconciledAt: "2026-08-20T00:00:00.000Z" }),
    ]) {
      const a = absenceAuthority(r);
      if (!a.authorised) expect(a.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("what goes stale after a scan", () => {
  it("an in-scope observation the run did not report goes stale", () => {
    expect(
      observationsToStale([obs()], new Set(), new Set(["asset-1"])),
    ).toEqual(["o-1"]);
  });

  it("an observation the run DID report survives", () => {
    expect(
      observationsToStale([obs()], new Set(["o-1"]), new Set(["asset-1"])),
    ).toEqual([]);
  });

  it("AN ASSET THAT WAS NOT SCANNED IS UNTOUCHED", () => {
    // The whole safety property in one assertion: a completed, scope-declared
    // run says nothing about assets it did not cover.
    expect(observationsToStale([obs()], new Set(), new Set(["other-asset"]))).toEqual([]);
  });

  it("an already-stale observation is not re-staled", () => {
    expect(
      observationsToStale([obs({ stale: true })], new Set(), new Set(["asset-1"])),
    ).toEqual([]);
  });

  it("stales only the in-scope subset of a mixed set", () => {
    const result = observationsToStale(
      [
        obs({ id: "in-scope", assetId: "asset-1" }),
        obs({ id: "out-of-scope", assetId: "asset-9" }),
      ],
      new Set(),
      new Set(["asset-1"]),
    );
    expect(result).toEqual(["in-scope"]);
  });
});

describe("presence derived from every source", () => {
  const o = (stale: boolean, sourceKey = "tenable"): Observation => ({
    id: `o-${sourceKey}`, occurrenceId: "occ-1", sourceKey, stale,
  });

  it("one live source keeps it present", () => {
    const d = presenceFromObservations("present", [o(false)]);
    expect(d.next).toBe("present");
  });

  it("becomes absent only when EVERY source has gone stale", () => {
    expect(presenceFromObservations("present", [o(true)]).next).toBe("absent");
    // Two scanners, one still reporting — NOT absent. One scanner losing
    // visibility must not silence the other.
    const mixed = presenceFromObservations("present", [o(true, "tenable"), o(false, "qualys")]);
    expect(mixed.next).toBe("present");
    expect(mixed.changed).toBe(false);
  });

  it("a stale source reporting again brings it back to present", () => {
    const d = presenceFromObservations("absent", [o(false)]);
    expect(d.next).toBe("present");
    expect(d.changed).toBe(true);
  });

  it("REMEDIATED IS NEVER OVERTURNED BY SILENCE", () => {
    // A person recorded that the work was done. A scanner going quiet is not a
    // contradiction of that, and letting it downgrade the record would replace a
    // human's claim with an inference.
    const d = presenceFromObservations("remediated", [o(true)]);
    expect(d.next).toBe("remediated");
    expect(d.changed).toBe(false);
    expect(d.reason).toMatch(/not overturned/i);
  });

  it("an occurrence with NO observations is left alone", () => {
    // Recorded by hand; no source owns it; reconciliation has no standing.
    const d = presenceFromObservations("present", []);
    expect(d.changed).toBe(false);
    expect(d.reason).toMatch(/recorded by hand/i);
  });
});
