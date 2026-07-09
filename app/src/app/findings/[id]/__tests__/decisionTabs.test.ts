/**
 * decisionTabs.test.ts — the Decision Workspace tab model (ERIP Package 3.3,
 * PR-4). Pure identity/default/guard coverage; the tab-strip DOM interaction is
 * a documented RTL follow-up (the app has no RTL harness — not faked here).
 */

import { describe, it, expect } from "vitest";
import { DECISION_TABS, DEFAULT_DECISION_TAB, isDecisionTab } from "../decisionTabs";

describe("decision workspace tabs", () => {
  it("exposes exactly Overview and Remediation, in that order", () => {
    expect(DECISION_TABS.map((t) => t.id)).toEqual(["overview", "remediation"]);
    expect(DECISION_TABS.map((t) => t.label)).toEqual(["Overview", "Remediation"]);
  });

  it("defaults to the Overview tab", () => {
    expect(DEFAULT_DECISION_TAB).toBe("overview");
    expect(DECISION_TABS.some((t) => t.id === DEFAULT_DECISION_TAB)).toBe(true);
  });

  it("recognizes valid tab ids and rejects others", () => {
    expect(isDecisionTab("overview")).toBe(true);
    expect(isDecisionTab("remediation")).toBe(true);
    expect(isDecisionTab("evidence")).toBe(false);
    expect(isDecisionTab("")).toBe(false);
  });
});
