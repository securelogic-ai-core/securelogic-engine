/**
 * briefDecision.test.ts — pure Brief → Decision flow logic (ERIP
 * launch-readiness, PR-B). Covers the linked/no-finding affordance and the
 * resolve gate, without a DOM/RTL harness (the app has none).
 */

import { describe, it, expect } from "vitest";
import { briefDecisionAffordance, shouldResolveBriefDecision, briefSupportingEventId } from "../briefDecision";

describe("briefDecisionAffordance", () => {
  it("deep-links into the Decision Workspace when a finding exists", () => {
    expect(briefDecisionAffordance({ id: "find-9" })).toEqual({
      state: "linked",
      findingId: "find-9",
      href: "/findings/find-9",
    });
  });

  it("points at Review Suggested Links when no finding exists", () => {
    expect(briefDecisionAffordance(null)).toEqual({ state: "no_finding", href: "/queue" });
    expect(briefDecisionAffordance(undefined)).toEqual({ state: "no_finding", href: "/queue" });
  });
});

describe("shouldResolveBriefDecision", () => {
  it("resolves only when the workspace is on AND a signal id is present", () => {
    expect(shouldResolveBriefDecision(true, "sig-1")).toBe(true);
  });

  it("does not resolve while the workspace is dark", () => {
    expect(shouldResolveBriefDecision(false, "sig-1")).toBe(false);
  });

  it("does not resolve without a signal id", () => {
    expect(shouldResolveBriefDecision(true, null)).toBe(false);
    expect(shouldResolveBriefDecision(true, "")).toBe(false);
    expect(shouldResolveBriefDecision(true, undefined)).toBe(false);
  });
});

describe("briefSupportingEventId (D5 Brief → Event bridge)", () => {
  it("picks the first resolvable event id from the finding context", () => {
    const ctx = { intelligence: { events: [{ id: "evt-1", title: "RCE" }, { id: "evt-2" }] } };
    expect(briefSupportingEventId(ctx)).toBe("evt-1");
  });
  it("skips events without a usable id", () => {
    const ctx = { intelligence: { events: [{ id: "" }, { title: "no id" }, { id: "evt-9" }] } };
    expect(briefSupportingEventId(ctx)).toBe("evt-9");
  });
  it("returns null when there is no context, no events, or none resolvable (honest degrade)", () => {
    expect(briefSupportingEventId(null)).toBeNull();
    expect(briefSupportingEventId(undefined)).toBeNull();
    expect(briefSupportingEventId({})).toBeNull();
    expect(briefSupportingEventId({ intelligence: { events: [] } })).toBeNull();
    expect(briefSupportingEventId({ intelligence: { events: [{ title: "x" }] } })).toBeNull();
  });
});
