/**
 * buildExecutiveNarrative (EG2 slice 13) — the deterministic "so what" page.
 * The properties under test: every sentence carries a concrete figure or named
 * object (no-generic-language standard), directions are computed from real
 * prior data, and empty inputs produce honest sentences, never filler.
 */
import { describe, it, expect } from "vitest";
import { buildExecutiveNarrative } from "../lib/executiveNarrative.js";

function baseData() {
  return {
    org_name: "Acme Financial",
    posture: { overall_score: 72, overall_severity: "Moderate", snapshot_date: "2026-07-30" },
    posture_prior: { overall_score: 63, snapshot_date: "2026-04-30" },
    period: {
      days: 90,
      findings_closed: 12,
      findings_risk_accepted: 2,
      findings_remediated: 15,
      findings_new: 9,
      risk_approvals: 3,
    },
    open_actions_count: 7,
    risks_by_rating: [
      { rating: "High", count: 3 },
      { rating: "Moderate", count: 5 },
    ],
    findings_by_severity: [
      { severity: "Critical", count: 1 },
      { severity: "High", count: 4 },
      { severity: "Moderate", count: 6 },
    ],
    frameworks: [
      { name: "SOC 2", total: 40, satisfied: 30, unmapped: 4 },
      { name: "NIST CSF", total: 57, satisfied: 20, unmapped: 22 },
    ],
  };
}

describe("buildExecutiveNarrative", () => {
  it("tells the posture story with position, direction, and dates", () => {
    const [posture] = buildExecutiveNarrative(baseData());
    expect(posture).toContain("Acme Financial's security posture scores 72 of 100 (Moderate)");
    expect(posture).toContain("up 9 points from 63 on April 30, 2026");
  });

  it("names the exposure: severe findings and the highest residual band", () => {
    const paragraphs = buildExecutiveNarrative(baseData());
    const exposure = paragraphs[1]!;
    expect(exposure).toContain("1 Critical finding and 4 High findings are active.");
    expect(exposure).toContain("highest open residual risk band is High, with 3 risks");
  });

  it("reports the period decision record and open remediation load", () => {
    const execution = buildExecutiveNarrative(baseData())[2]!;
    expect(execution).toContain("closed 12 findings");
    expect(execution).toContain("completed remediation on 15");
    expect(execution).toContain("formally accepted 2 risks");
    expect(execution).toContain("9 new findings");
    expect(execution).toContain("7 remediation actions remain open");
  });

  it("names the strongest framework and the widest gap", () => {
    const compliance = buildExecutiveNarrative(baseData())[3]!;
    expect(compliance).toContain("strongest on SOC 2 at 75%");
    expect(compliance).toContain("NIST CSF carries the largest gap, with 22 requirements");
  });

  it("leadership focus escalates to Critical findings when any exist", () => {
    const focus = buildExecutiveNarrative(baseData())[4]!;
    expect(focus).toContain("Leadership focus: the 1 Critical finding");
  });

  it("without Critical findings, focus falls to the High residual band", () => {
    const data = baseData();
    data.findings_by_severity = [{ severity: "High", count: 2 }];
    const focus = buildExecutiveNarrative(data)[4]!;
    expect(focus).toContain("3 High residual risks");
  });

  it("empty program: honest baseline sentences, never generic filler", () => {
    const paragraphs = buildExecutiveNarrative({
      org_name: "Fresh Org",
      posture: null,
      posture_prior: null,
      period: { days: 90, findings_closed: 0, findings_risk_accepted: 0, findings_remediated: 0, findings_new: 0, risk_approvals: 0 },
      open_actions_count: 0,
      risks_by_rating: [],
      findings_by_severity: [],
      frameworks: [],
    });
    expect(paragraphs[0]).toContain("no posture snapshot yet");
    expect(paragraphs[1]).toContain("No Critical or High findings are active.");
    expect(paragraphs[3]).toContain("No compliance frameworks are activated");
    // The banned generic vocabulary never appears.
    const all = paragraphs.join(" ");
    expect(all).not.toMatch(/may affect|could potentially|underscores|organizations should/i);
  });

  it("no prior snapshot: the baseline is declared, not a fake delta", () => {
    const data = baseData();
    data.posture_prior = null;
    expect(buildExecutiveNarrative(data)[0]).toContain("this report establishes the baseline");
  });
});
