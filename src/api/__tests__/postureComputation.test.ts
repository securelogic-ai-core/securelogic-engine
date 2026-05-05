import { describe, it, expect } from "vitest";
import {
  computePosture,
  severityToPriority,
  FALLBACK_CONTEXT,
  type DbFindingForPosture,
  type OrgContext
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

const NEUTRAL: OrgContext = {
  regulated: false,
  handlesPII: false,
  safetyCritical: false,
  scale: "Small"
};

const REGULATED: OrgContext = {
  regulated: true,
  handlesPII: false,
  safetyCritical: false,
  scale: "Small"
};

const FULL_AMPLIFICATION: OrgContext = {
  regulated: true,
  handlesPII: true,
  safetyCritical: true,
  scale: "Enterprise"
};

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
// FALLBACK_CONTEXT
// ----------------------------------------------------------------

describe("FALLBACK_CONTEXT", () => {
  it("is equivalent to a neutral context (no amplification flags set)", () => {
    expect(FALLBACK_CONTEXT.regulated).toBe(false);
    expect(FALLBACK_CONTEXT.handlesPII).toBe(false);
    expect(FALLBACK_CONTEXT.safetyCritical).toBe(false);
    expect(FALLBACK_CONTEXT.scale).toBe("Small");
  });
});

// ----------------------------------------------------------------
// computePosture — empty findings
// ----------------------------------------------------------------

describe("computePosture — no findings", () => {
  it("returns null overall_score when there are no findings", () => {
    const result = computePosture([], 0, 0, NEUTRAL);
    expect(result.overall_score).toBeNull();
    expect(result.overall_severity).toBeNull();
  });

  it("returns empty domain_scores when there are no findings", () => {
    const result = computePosture([], 0, 0, NEUTRAL);
    expect(result.domain_scores).toHaveLength(0);
  });

  it("reflects action counts even with no findings", () => {
    const result = computePosture([], 5, 2, NEUTRAL);
    expect(result.open_action_count).toBe(5);
    expect(result.overdue_action_count).toBe(2);
    expect(result.open_finding_count).toBe(0);
  });

  it("includes a clear note in computation_rationale", () => {
    const result = computePosture([], 0, 0, NEUTRAL);
    const note = result.computation_rationale["note"];
    expect(typeof note).toBe("string");
    expect(note as string).toContain("No open findings");
  });

  it("includes context_applied in computation_rationale even with no findings", () => {
    const result = computePosture([], 0, 0, REGULATED);
    const ctx = result.computation_rationale["context_applied"] as Record<string, unknown>;
    expect(ctx).toBeDefined();
    expect(ctx["regulated"]).toBe(true);
  });

  it("default orgContext falls back to FALLBACK_CONTEXT", () => {
    const withDefault = computePosture([], 0, 0);
    const withExplicit = computePosture([], 0, 0, FALLBACK_CONTEXT);
    expect(withDefault.computation_rationale).toEqual(withExplicit.computation_rationale);
  });
});

// ----------------------------------------------------------------
// computePosture — single domain
// ----------------------------------------------------------------

describe("computePosture — single domain findings", () => {
  it("produces a domain score for the finding domain", () => {
    const findings = [makeFinding("1", "High", "Governance")];
    const result = computePosture(findings, 0, 0, NEUTRAL);
    const domain = result.domain_scores.find((d) => d.domain === "Governance");
    expect(domain).toBeDefined();
    expect(domain!.finding_count).toBe(1);
  });

  it("produces a non-null overall_score when findings exist", () => {
    const findings = [makeFinding("1", "High", "Governance")];
    const result = computePosture(findings, 0, 0, NEUTRAL);
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score).toBeGreaterThan(0);
    expect(result.overall_score).toBeLessThanOrEqual(100);
  });

  it("higher severity findings produce higher scores", () => {
    const low      = computePosture([makeFinding("1", "Low",      "Governance")], 0, 0, NEUTRAL);
    const high     = computePosture([makeFinding("1", "High",     "Governance")], 0, 0, NEUTRAL);
    const critical = computePosture([makeFinding("1", "Critical", "Governance")], 0, 0, NEUTRAL);

    expect(high.overall_score!).toBeGreaterThan(low.overall_score!);
    expect(critical.overall_score!).toBeGreaterThan(high.overall_score!);
  });

  it("domain score severity maps to a recognizable value", () => {
    const findings = [makeFinding("1", "Critical", "Governance")];
    const result = computePosture(findings, 0, 0, NEUTRAL);
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
      makeFinding("1", "High",     "Governance"),
      makeFinding("2", "Moderate", "Compliance"),
      makeFinding("3", "Low",      "VendorRisk")
    ];
    const result = computePosture(findings, 0, 0, NEUTRAL);
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
      makeFinding("4", "High",     "VendorRisk")
    ];
    const result = computePosture(findings, 10, 3, NEUTRAL);
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score!).toBeGreaterThanOrEqual(0);
    expect(result.overall_score!).toBeLessThanOrEqual(100);
  });

  it("more findings in a domain increase that domain score", () => {
    const one = computePosture(
      [makeFinding("1", "High", "Governance")],
      0, 0, NEUTRAL
    );
    const three = computePosture(
      [
        makeFinding("1", "High", "Governance"),
        makeFinding("2", "High", "Governance"),
        makeFinding("3", "High", "Governance")
      ],
      0, 0, NEUTRAL
    );

    const oneScore   = one.domain_scores.find((d) => d.domain === "Governance")!.score!;
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
    const result = computePosture(findings, 0, 0, NEUTRAL);
    const general = result.domain_scores.find((d) => d.domain === "General");
    expect(general).toBeDefined();
    expect(general!.finding_count).toBe(1);
  });

  it("includes null domain count in computation_rationale", () => {
    const findings = [
      makeFinding("1", "High", null),
      makeFinding("2", "Low",  "Governance")
    ];
    const result = computePosture(findings, 0, 0, NEUTRAL);
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
      makeFinding("2", "Low",  "Compliance")
    ];
    const result = computePosture(findings, 3, 1, NEUTRAL);
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
    const result = computePosture([makeFinding("1", "High", "Governance")], 0, 0, NEUTRAL);
    const engine = result.computation_rationale["engine"];
    expect(typeof engine).toBe("string");
    expect(engine as string).toContain("DomainRiskAggregationEngineV2");
  });

  it("includes context_applied with actual org context values", () => {
    const result = computePosture([makeFinding("1", "High", "Governance")], 0, 0, REGULATED);
    const ctx = result.computation_rationale["context_applied"] as Record<string, unknown>;
    expect(ctx).toBeDefined();
    expect(ctx["regulated"]).toBe(true);
    expect(ctx["handles_pii"]).toBe(false);
    expect(ctx["scale"]).toBe("Small");
  });

  it("context_applied reflects full amplification context", () => {
    const result = computePosture([makeFinding("1", "High", "Governance")], 0, 0, FULL_AMPLIFICATION);
    const ctx = result.computation_rationale["context_applied"] as Record<string, unknown>;
    expect(ctx["regulated"]).toBe(true);
    expect(ctx["handles_pii"]).toBe(true);
    expect(ctx["safety_critical"]).toBe(true);
    expect(ctx["scale"]).toBe("Enterprise");
  });

  it("does not include a limitation note — context weighting is now live", () => {
    const result = computePosture([makeFinding("1", "Low", "Governance")], 0, 0, NEUTRAL);
    expect(result.computation_rationale["limitation"]).toBeUndefined();
  });
});

// ----------------------------------------------------------------
// computePosture — context weighting produces real score differences
// ----------------------------------------------------------------

describe("computePosture — context weighting", () => {
  const findings = [makeFinding("1", "High", "Governance")];

  it("regulated org scores higher than non-regulated with identical findings", () => {
    const neutral    = computePosture(findings, 0, 0, NEUTRAL);
    const regulated  = computePosture(findings, 0, 0, REGULATED);
    expect(regulated.overall_score!).toBeGreaterThan(neutral.overall_score!);
  });

  it("handles_pii org scores higher than non-pii with identical findings", () => {
    const neutral = computePosture(findings, 0, 0, NEUTRAL);
    const pii     = computePosture(findings, 0, 0, { ...NEUTRAL, handlesPII: true });
    expect(pii.overall_score!).toBeGreaterThan(neutral.overall_score!);
  });

  it("safety_critical org scores higher than non-critical with identical findings", () => {
    const neutral  = computePosture(findings, 0, 0, NEUTRAL);
    const critical = computePosture(findings, 0, 0, { ...NEUTRAL, safetyCritical: true });
    expect(critical.overall_score!).toBeGreaterThan(neutral.overall_score!);
  });

  it("Enterprise scale org scores higher than Small with identical findings", () => {
    const small      = computePosture(findings, 0, 0, { ...NEUTRAL, scale: "Small" });
    const enterprise = computePosture(findings, 0, 0, { ...NEUTRAL, scale: "Enterprise" });
    expect(enterprise.overall_score!).toBeGreaterThan(small.overall_score!);
  });

  it("full amplification scores higher than neutral with identical findings", () => {
    const neutral = computePosture(findings, 0, 0, NEUTRAL);
    const full    = computePosture(findings, 0, 0, FULL_AMPLIFICATION);
    expect(full.overall_score!).toBeGreaterThan(neutral.overall_score!);
  });

  it("scores are clamped at 100 even with full amplification and Critical findings", () => {
    const criticalFindings = [
      makeFinding("1", "Critical", "Governance"),
      makeFinding("2", "Critical", "Governance"),
      makeFinding("3", "Critical", "Compliance")
    ];
    const result = computePosture(criticalFindings, 0, 0, FULL_AMPLIFICATION);
    expect(result.overall_score!).toBeLessThanOrEqual(100);
    result.domain_scores.forEach((ds) => {
      expect(ds.score!).toBeLessThanOrEqual(100);
    });
  });

  it("domain rationale string reflects actual context summary", () => {
    const result = computePosture(findings, 0, 0, REGULATED);
    const gov = result.domain_scores.find((d) => d.domain === "Governance");
    expect(gov).toBeDefined();
    // Should not say "(neutral)" — context is real
    expect(gov!.rationale).not.toContain("(neutral)");
    expect(gov!.rationale).toContain("regulated");
  });

  it("domain rationale for neutral context reflects scale only", () => {
    const result = computePosture(findings, 0, 0, NEUTRAL);
    const gov = result.domain_scores.find((d) => d.domain === "Governance");
    expect(gov).toBeDefined();
    // With no amplification flags, context summary is "scale:Small"
    expect(gov!.rationale).toContain("scale:Small");
  });
});

// ====================================================================
// risk-posture-integration — riskSignalCount in rationale
// ====================================================================

describe("computePosture — riskSignalCount in computation_rationale", () => {
  const signal = makeFinding("r1", "High", "Vendor Risk");

  it("rationale note does not include risk breakdown when riskSignalCount is 0 (default)", () => {
    const result = computePosture([signal], 0, 0, FALLBACK_CONTEXT);
    const note = result.computation_rationale["note"] as string;
    expect(note).not.toContain("risk");
  });

  it("rationale note includes risk breakdown when riskSignalCount > 0", () => {
    const result = computePosture([signal], 0, 0, FALLBACK_CONTEXT, 1);
    const note = result.computation_rationale["note"] as string;
    expect(note).toContain("1 open risk");
  });

  it("rationale note includes finding count when riskSignalCount > 0", () => {
    const f = makeFinding("f1", "Critical", "General");
    const r = makeFinding("r1", "High", "Vendor Risk");
    const result = computePosture([f, r], 0, 0, FALLBACK_CONTEXT, 1);
    const note = result.computation_rationale["note"] as string;
    expect(note).toContain("1 finding");
    expect(note).toContain("1 open risk");
  });

  it("risk_signals_included is 0 when no risk signals", () => {
    const result = computePosture([signal], 0, 0, FALLBACK_CONTEXT);
    expect(result.computation_rationale["risk_signals_included"]).toBe(0);
  });

  it("risk_signals_included matches riskSignalCount when provided", () => {
    const result = computePosture([signal], 0, 0, FALLBACK_CONTEXT, 1);
    expect(result.computation_rationale["risk_signals_included"]).toBe(1);
  });

  it("scoring is not affected by riskSignalCount — same signals produce same score", () => {
    const r1 = computePosture([signal], 0, 0, FALLBACK_CONTEXT, 0);
    const r2 = computePosture([signal], 0, 0, FALLBACK_CONTEXT, 1);
    expect(r1.overall_score).toBe(r2.overall_score);
    expect(r1.overall_severity).toBe(r2.overall_severity);
  });
});

// ----------------------------------------------------------------
// Engine-consumption of synthetic vendor-inventory signals
// ----------------------------------------------------------------
//
// These tests exercise `computePosture` with DbFindingForPosture entries
// shaped exactly like the output of `vendorCriticalityToSignals`. The
// engine doesn't distinguish synthetic from real — these confirm the
// merged pipeline produces sensible Vendor Risk domain scores when
// inventory state, not real findings, is the only signal source.
//
// The synthesis function itself is unit-tested in
// inventoryToSignals.test.ts; these tests cover the consumption side.

function makeSyntheticVendorSignal(
  vendorId: string,
  severity: "Low" | "Moderate" | "High" | "Critical"
): DbFindingForPosture {
  return {
    id: `vendor-criticality:${vendorId}`,
    title: `Active vendor with ${severity.toLowerCase()} criticality`,
    domain: "Vendor Risk",
    severity,
  };
}

describe("computePosture — synthetic vendor-inventory signals", () => {
  it("six high-criticality vendors with no real findings produce a non-zero Vendor Risk domain score", () => {
    // Pre-package: zero findings + zero risks → overall_score null,
    // empty domain_scores. With this package, the same org with six
    // high-criticality vendors emits six synthetic High signals.
    const synthetic = [
      makeSyntheticVendorSignal("v1", "High"),
      makeSyntheticVendorSignal("v2", "High"),
      makeSyntheticVendorSignal("v3", "High"),
      makeSyntheticVendorSignal("v4", "High"),
      makeSyntheticVendorSignal("v5", "High"),
      makeSyntheticVendorSignal("v6", "High"),
    ];

    const result = computePosture(synthetic, 0, 0, NEUTRAL);

    expect(result.domain_scores).toHaveLength(1);
    const vrDomain = result.domain_scores[0]!;
    expect(vrDomain.domain).toBe("Vendor Risk");
    // Engine math: max severity weight (High=70) + accumulation
    // boost (log2(7)*15 capped at 30) = 70 + ~30 = 100. Six entries
    // saturate the accumulation cap.
    expect(vrDomain.score).toBeGreaterThanOrEqual(70);
    expect(vrDomain.finding_count).toBe(6);
    expect(result.overall_score).not.toBeNull();
  });

  it("synthetic signals merge with real findings without dedup (combined accumulation)", () => {
    // Spec item 5: "A vendor with both criticality='critical' AND an
    // open Critical finding contributes TWO Critical signals to
    // Vendor Risk." Verify the engine doesn't surprise us by
    // collapsing them.
    const realFinding = makeFinding("real-1", "Critical", "Vendor Risk");
    const synthetic = makeSyntheticVendorSignal("v1", "Critical");

    const justReal = computePosture([realFinding], 0, 0, NEUTRAL);
    const both = computePosture([realFinding, synthetic], 0, 0, NEUTRAL);

    // Both reach the same domain. The two-signal case should never
    // score LOWER than the one-signal case (engine accumulation is
    // monotonic in N).
    expect(both.domain_scores).toHaveLength(1);
    expect(justReal.domain_scores).toHaveLength(1);
    const bothVR = both.domain_scores[0]!;
    const justRealVR = justReal.domain_scores[0]!;
    expect(bothVR.finding_count).toBe(2);
    expect(justRealVR.finding_count).toBe(1);
    expect(bothVR.score! >= justRealVR.score!).toBe(true);
  });

  it("zero synthetic signals + zero real findings reproduces pre-package empty-state behavior", () => {
    // Regression guard: an org with no inventory and no findings
    // must score the same after this package as before. (overall
    // null, no domain_scores.) This is the case the deploy notes
    // promise won't change for any current empty-state org.
    const result = computePosture([], 0, 0, NEUTRAL);
    expect(result.overall_score).toBeNull();
    expect(result.domain_scores).toEqual([]);
  });
});
