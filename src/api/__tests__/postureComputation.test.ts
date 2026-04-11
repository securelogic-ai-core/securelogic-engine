import { describe, it, expect } from "vitest";
import {
  computePosture,
  severityToPriority,
  type DbFindingForPosture
} from "../lib/postureComputation.js";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeFinding(
  id: string,
  severity: string,
  domain: string | null = "Governance"
): DbFindingForPosture {
  return { id, title: `Finding ${id}`, domain, severity };
}

// ----------------------------------------------------------------
// severityToPriority
// ----------------------------------------------------------------

describe("severityToPriority", () => {
  it("maps Critical to immediate", () => {
    expect(severityToPriority("Critical")).toBe("immediate");
  });

  it("maps High to near_term", () => {
    expect(severityToPriority("High")).toBe("near_term");
  });

  it("maps Moderate to planned", () => {
    expect(severityToPriority("Moderate")).toBe("planned");
  });

  it("maps Low to watch", () => {
    expect(severityToPriority("Low")).toBe("watch");
  });

  it("maps unknown values to watch (safe fallback)", () => {
    expect(severityToPriority("Unknown")).toBe("watch");
  });
});

// ----------------------------------------------------------------
// computePosture — empty findings
// ----------------------------------------------------------------

describe("computePosture — no findings", () => {
  it("returns null overall_score when there are no findings", () => {
    const result = computePosture([], 0, 0);
    expect(result.overall_score).toBeNull();
    expect(result.overall_severity).toBeNull();
  });

  it("returns empty domain_scores when there are no findings", () => {
    const result = computePosture([], 0, 0);
    expect(result.domain_scores).toHaveLength(0);
  });

  it("reflects action counts even with no findings", () => {
    const result = computePosture([], 5, 2);
    expect(result.open_action_count).toBe(5);
    expect(result.overdue_action_count).toBe(2);
    expect(result.open_finding_count).toBe(0);
  });

  it("includes a clear note in computation_rationale", () => {
    const result = computePosture([], 0, 0);
    const note = result.computation_rationale["note"];
    expect(typeof note).toBe("string");
    expect(note as string).toContain("No open findings");
  });
});

// ----------------------------------------------------------------
// computePosture — single domain
// ----------------------------------------------------------------

describe("computePosture — single domain findings", () => {
  it("produces a domain score for the finding domain", () => {
    const findings = [makeFinding("1", "High", "Governance")];
    const result = computePosture(findings, 0, 0);
    const domain = result.domain_scores.find((d) => d.domain === "Governance");
    expect(domain).toBeDefined();
    expect(domain!.finding_count).toBe(1);
  });

  it("produces a non-null overall_score when findings exist", () => {
    const findings = [makeFinding("1", "High", "Governance")];
    const result = computePosture(findings, 0, 0);
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score).toBeGreaterThan(0);
    expect(result.overall_score).toBeLessThanOrEqual(100);
  });

  it("higher severity findings produce higher scores", () => {
    const low = computePosture([makeFinding("1", "Low", "Governance")], 0, 0);
    const high = computePosture([makeFinding("1", "High", "Governance")], 0, 0);
    const critical = computePosture(
      [makeFinding("1", "Critical", "Governance")],
      0,
      0
    );

    expect(high.overall_score!).toBeGreaterThan(low.overall_score!);
    expect(critical.overall_score!).toBeGreaterThan(high.overall_score!);
  });

  it("domain score severity maps to a recognizable value", () => {
    const findings = [makeFinding("1", "Critical", "Governance")];
    const result = computePosture(findings, 0, 0);
    const domain = result.domain_scores.find((d) => d.domain === "Governance");
    expect(["Low", "Moderate", "High", "Critical"]).toContain(domain!.severity);
  });
});

// ----------------------------------------------------------------
// computePosture — multiple domains
// ----------------------------------------------------------------

describe("computePosture — multiple domains", () => {
  it("produces one domain_score entry per distinct domain", () => {
    const findings = [
      makeFinding("1", "High", "Governance"),
      makeFinding("2", "Moderate", "Compliance"),
      makeFinding("3", "Low", "VendorRisk")
    ];
    const result = computePosture(findings, 0, 0);
    expect(result.domain_scores).toHaveLength(3);

    const domains = result.domain_scores.map((d) => d.domain);
    expect(domains).toContain("Governance");
    expect(domains).toContain("Compliance");
    expect(domains).toContain("VendorRisk");
  });

  it("overall_score is within 0–100 range", () => {
    const findings = [
      makeFinding("1", "Critical", "Governance"),
      makeFinding("2", "Critical", "Compliance"),
      makeFinding("3", "Critical", "VendorRisk"),
      makeFinding("4", "High", "VendorRisk")
    ];
    const result = computePosture(findings, 10, 3);
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score!).toBeGreaterThanOrEqual(0);
    expect(result.overall_score!).toBeLessThanOrEqual(100);
  });

  it("more findings in a domain increase that domain score", () => {
    const one = computePosture(
      [makeFinding("1", "High", "Governance")],
      0,
      0
    );
    const three = computePosture(
      [
        makeFinding("1", "High", "Governance"),
        makeFinding("2", "High", "Governance"),
        makeFinding("3", "High", "Governance")
      ],
      0,
      0
    );

    const oneScore = one.domain_scores.find((d) => d.domain === "Governance")!.score!;
    const threeScore = three.domain_scores.find((d) => d.domain === "Governance")!.score!;
    expect(threeScore).toBeGreaterThanOrEqual(oneScore);
  });
});

// ----------------------------------------------------------------
// computePosture — null domain handling
// ----------------------------------------------------------------

describe("computePosture — null domain findings", () => {
  it("buckets null-domain findings under General", () => {
    const findings = [makeFinding("1", "High", null)];
    const result = computePosture(findings, 0, 0);
    const general = result.domain_scores.find((d) => d.domain === "General");
    expect(general).toBeDefined();
    expect(general!.finding_count).toBe(1);
  });

  it("includes null domain count in computation_rationale", () => {
    const findings = [
      makeFinding("1", "High", null),
      makeFinding("2", "Low", "Governance")
    ];
    const result = computePosture(findings, 0, 0);
    expect(result.computation_rationale["null_domain_findings"]).not.toBe(0);
  });
});

// ----------------------------------------------------------------
// computePosture — counts
// ----------------------------------------------------------------

describe("computePosture — counts", () => {
  it("reflects the correct open_finding_count", () => {
    const findings = [
      makeFinding("1", "High", "Governance"),
      makeFinding("2", "Low", "Compliance")
    ];
    const result = computePosture(findings, 3, 1);
    expect(result.open_finding_count).toBe(2);
    expect(result.open_action_count).toBe(3);
    expect(result.overdue_action_count).toBe(1);
  });
});

// ----------------------------------------------------------------
// computePosture — computation_rationale
// ----------------------------------------------------------------

describe("computePosture — computation_rationale", () => {
  it("contains engine identification", () => {
    const result = computePosture([makeFinding("1", "High", "Governance")], 0, 0);
    const engine = result.computation_rationale["engine"];
    expect(typeof engine).toBe("string");
    expect(engine as string).toContain("DomainRiskAggregationEngineV2");
  });

  it("mentions neutral context", () => {
    const result = computePosture([makeFinding("1", "Low", "Governance")], 0, 0);
    const ctxNote = result.computation_rationale["context_weighting"];
    expect(typeof ctxNote).toBe("string");
    expect(ctxNote as string).toContain("neutral");
  });

  it("includes limitation note about org profile", () => {
    const result = computePosture([makeFinding("1", "Low", "Governance")], 0, 0);
    const limitation = result.computation_rationale["limitation"];
    expect(typeof limitation).toBe("string");
    expect((limitation as string).length).toBeGreaterThan(0);
  });
});
