/**
 * eventRecommendedActions.test.ts — Intelligence Pipeline Hardening (item 8).
 */

import { describe, it, expect } from "vitest";
import { recommendedActions } from "../../lib/signals/eventRecommendedActions.js";

describe("recommendedActions", () => {
  it("prioritizes remediation for an actively-exploited event", () => {
    const a = recommendedActions({ status: "actively_exploited", severity: "Critical", affected_vendor: "Acme", affected_cve: "CVE-2026-1", hasFinding: false });
    expect(a[0].urgency).toBe("immediate");
    expect(a[0].action).toContain("CVE-2026-1");
  });

  it("recommends applying the patch for a mitigated event", () => {
    const a = recommendedActions({ status: "mitigated", severity: "High", affected_vendor: null, affected_cve: null, hasFinding: true });
    expect(a.some((x) => x.action.includes("patch"))).toBe(true);
  });

  it("suggests opening a finding when none exists for a high-severity event", () => {
    const a = recommendedActions({ status: "confirmed", severity: "High", affected_vendor: null, affected_cve: null, hasFinding: false });
    expect(a.some((x) => x.action.includes("tracked finding"))).toBe(true);
  });

  it("advises monitoring for a new low-severity event", () => {
    const a = recommendedActions({ status: "new", severity: "Low", affected_vendor: null, affected_cve: null, hasFinding: false });
    expect(a.some((x) => x.action.toLowerCase().includes("monitor"))).toBe(true);
  });
});
