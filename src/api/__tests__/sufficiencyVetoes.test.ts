/**
 * VA-S4-4C-4. The twelve coverage vetoes.
 *
 * The assertions that matter here are the NEGATIVE ones: that a veto which
 * cannot be computed never reads PASSED, and that SUFFICIENT is unreachable
 * while any veto is unresolved. Everything else is normalizer detail.
 */
import { describe, it, expect } from "vitest";
import {
  COVERAGE_VETOES,
  EVALUATED_VETOES,
  STRUCTURAL_VETOES,
  VETO_EVALUATOR_VERSION,
  normalizeReportType,
  categoryOfCriterion,
  categoryOfScopeEntry,
  scopeCoversCriterion,
  normalizeSubserviceMethod,
  evaluateVetoes,
  determinationPrecondition,
  buildDeterminationBasis,
  type VetoInput,
  type VetoEvaluation,
  type CoverageVeto,
} from "../lib/vendorAssurance/sufficiencyVetoes.js";

/** A candidate on which every computable veto passes. Deliberately artificial. */
function cleanInput(over: Partial<VetoInput> = {}): VetoInput {
  return {
    requirementReference: "CC6.1",
    reportType: "SOC 2 Type II",
    reportPeriodStart: "2025-01-01",
    reportPeriodEnd: "2025-12-31",
    trustServicesCriteria: ["Security", "Availability"],
    subserviceMethod: "Inclusive",
    exceptionsFieldPresent: true,
    linkedExceptions: [],
    acceptedOpinion: "unmodified",
    effectivenessDecision: "accepted",
    governedEffectiveness: "EFFECTIVE",
    mappingSource: "securelogic",
    mappingStatus: "published",
    mappingApproved: true,
    openFindingsOnCanonicalControl: 0,
    contradictoryEvidenceQueryable: true,
    asOf: new Date("2026-08-31T00:00:00Z"),
    ...over,
  };
}

const stateOf = (evals: VetoEvaluation[], veto: CoverageVeto) =>
  evals.find((e) => e.veto === veto)?.state;
const reasonOf = (evals: VetoEvaluation[], veto: CoverageVeto) =>
  evals.find((e) => e.veto === veto)?.reason;

describe("the veto vocabulary", () => {
  it("is twelve, and the two structural ones are not evaluated here", () => {
    expect(COVERAGE_VETOES).toHaveLength(12);
    expect(STRUCTURAL_VETOES).toHaveLength(2);
    expect(EVALUATED_VETOES).toHaveLength(10);
    expect(EVALUATED_VETOES.some((v) => STRUCTURAL_VETOES.includes(v))).toBe(false);
  });

  it("evaluates every non-structural veto exactly once", () => {
    const evals = evaluateVetoes(cleanInput());
    expect(evals.map((e) => e.veto).sort()).toEqual([...EVALUATED_VETOES].sort());
  });
});

describe("normalizeReportType — precedence is load-bearing", () => {
  it("reads both measured spellings of Type II as one value", () => {
    expect(normalizeReportType("SOC 2 Type 2")).toBe("TYPE_II");
    expect(normalizeReportType("SOC 2 Type II")).toBe("TYPE_II");
    expect(normalizeReportType("soc 2 type ii")).toBe("TYPE_II");
  });

  it("does NOT read 'Type II' as 'Type I' — the prefix trap", () => {
    // If the Type I branch were tested first it would match "Type II" too and
    // silently downgrade every Type II report in the estate to design-only.
    expect(normalizeReportType("SOC 2 Type II")).not.toBe("TYPE_I");
  });

  it("reads Type I, which has a real corpus witness", () => {
    expect(normalizeReportType("SOC 2 Type I")).toBe("TYPE_I");
    expect(normalizeReportType("SOC 2 Type 1")).toBe("TYPE_I");
  });

  it("returns null rather than guessing", () => {
    expect(normalizeReportType("SOC 3")).toBeNull();
    expect(normalizeReportType(null)).toBeNull();
    expect(normalizeReportType("")).toBeNull();
  });
});

describe("TSC grain — the longest prefix must win", () => {
  it("files CC as Security, not Confidentiality", () => {
    expect(categoryOfCriterion("CC6.1")).toBe("security");
    expect(categoryOfCriterion("CC7.2")).toBe("security");
  });

  it("files PI as Processing Integrity, not Privacy", () => {
    expect(categoryOfCriterion("PI1.1")).toBe("processing_integrity");
  });

  it("still files the single-letter families correctly", () => {
    expect(categoryOfCriterion("A1.1")).toBe("availability");
    expect(categoryOfCriterion("C1.1")).toBe("confidentiality");
    expect(categoryOfCriterion("P3.2")).toBe("privacy");
  });

  it("recognises category entries as well as criteria", () => {
    expect(categoryOfScopeEntry("Security")).toBe("security");
    expect(categoryOfScopeEntry("Processing Integrity")).toBe("processing_integrity");
    expect(categoryOfScopeEntry("CC6.1")).toBeNull();
  });
});

describe("scopeCoversCriterion — the corpus is MIXED-GRAIN", () => {
  it("matches an explicitly listed criterion", () => {
    expect(scopeCoversCriterion(["CC6.1", "CC6.2"], "CC6.1")).toEqual({
      covered: true,
      grain: "criterion",
    });
  });

  it("matches through the category, which is the whole point", () => {
    // A report scoped to `Security` covers CC6.1 without ever naming it.
    expect(scopeCoversCriterion(["Security", "Availability"], "CC6.1")).toEqual({
      covered: true,
      grain: "category",
    });
  });

  it("handles both grains in one array, as measured on staging", () => {
    const scope = ["A1.1", "A1.2", "CC6.1", "Availability", "Security", "Confidentiality"];
    expect(scopeCoversCriterion(scope, "CC7.2").covered).toBe(true);
    expect(scopeCoversCriterion(scope, "PI1.1").covered).toBe(false);
  });

  it("does not cover on an empty or absent scope", () => {
    expect(scopeCoversCriterion([], "CC6.1").covered).toBe(false);
    expect(scopeCoversCriterion(null, "CC6.1").covered).toBe(false);
  });
});

describe("normalizeSubserviceMethod", () => {
  it("is case-insensitive, because the corpus is not consistent", () => {
    expect(normalizeSubserviceMethod("Carve-out")).toBe("carve_out");
    expect(normalizeSubserviceMethod("carve-out")).toBe("carve_out");
    expect(normalizeSubserviceMethod("CARVE OUT")).toBe("carve_out");
    expect(normalizeSubserviceMethod("Inclusive")).toBe("inclusive");
  });

  it("returns null for the majority NULL case rather than assuming", () => {
    expect(normalizeSubserviceMethod(null)).toBeNull();
    expect(normalizeSubserviceMethod("")).toBeNull();
  });
});

describe("the invariant: absent substrate never reads PASSED", () => {
  it("report_scope is NOT_EVALUABLE when the report states no scope", () => {
    const e = evaluateVetoes(cleanInput({ trustServicesCriteria: null }));
    expect(stateOf(e, "report_scope")).toBe("NOT_EVALUABLE");
    expect(reasonOf(e, "report_scope")).toBe("scope_not_stated");
  });

  it("report_scope FIRES for a criterion the report genuinely excludes", () => {
    const e = evaluateVetoes(
      cleanInput({ trustServicesCriteria: ["Security"], requirementReference: "P3.2" })
    );
    expect(stateOf(e, "report_scope")).toBe("FIRED");
  });

  it("report_scope is NOT_EVALUABLE — not FIRED — for an unplaceable criterion", () => {
    // We cannot say a criterion is out of scope when we cannot even file it.
    const e = evaluateVetoes(
      cleanInput({ trustServicesCriteria: ["Security"], requirementReference: "ZZ9.9" })
    );
    expect(stateOf(e, "report_scope")).toBe("NOT_EVALUABLE");
  });

  it("report_period is NEVER PASSED — there is no ratified validity policy", () => {
    const e = evaluateVetoes(cleanInput());
    expect(stateOf(e, "report_period")).toBe("NOT_EVALUABLE");
    expect(reasonOf(e, "report_period")).toBe("no_ratified_validity_policy");
    // The FACT is still recorded, so the reviewer can see how stale it is.
    const observed = e.find((x) => x.veto === "report_period")?.observed ?? {};
    expect(observed["days_since_period_end"]).toBe(243);
  });

  it("carve_out is NOT_EVALUABLE when unstated — owner ruling, and the majority case", () => {
    const e = evaluateVetoes(cleanInput({ subserviceMethod: null }));
    expect(stateOf(e, "carve_out")).toBe("NOT_EVALUABLE");
    expect(reasonOf(e, "carve_out")).toBe("subservice_method_not_stated");
  });

  it("carve_out is NOT_EVALUABLE when a carve-out exists but is unattributed", () => {
    const e = evaluateVetoes(cleanInput({ subserviceMethod: "Carve-out" }));
    expect(stateOf(e, "carve_out")).toBe("NOT_EVALUABLE");
  });

  it("contradictory_evidence is NOT_EVALUABLE until ADR-0012 exists", () => {
    const e = evaluateVetoes(cleanInput({ contradictoryEvidenceQueryable: false }));
    expect(stateOf(e, "contradictory_evidence")).toBe("NOT_EVALUABLE");
    expect(reasonOf(e, "contradictory_evidence")).toBe("no_evidence_link_substrate");
  });

  it("open_findings is NOT_EVALUABLE on a null count, NEVER passed-by-zero", () => {
    // This is the trap: framework_control_id is unpopulated estate-wide, so a
    // zero from a join would mean "nothing writes this column".
    const e = evaluateVetoes(cleanInput({ openFindingsOnCanonicalControl: null }));
    expect(stateOf(e, "open_findings")).toBe("NOT_EVALUABLE");
    expect(reasonOf(e, "open_findings")).toBe("open_findings_not_countable");
  });

  it("tested_control_result is NOT_EVALUABLE when Layer 2 has decided nothing", () => {
    const e = evaluateVetoes(
      cleanInput({ effectivenessDecision: null, governedEffectiveness: null })
    );
    expect(stateOf(e, "tested_control_result")).toBe("NOT_EVALUABLE");
  });

  it("mapping_authority is NOT_EVALUABLE when provenance is missing", () => {
    const e = evaluateVetoes(cleanInput({ mappingSource: null, mappingStatus: null }));
    expect(stateOf(e, "mapping_authority")).toBe("NOT_EVALUABLE");
  });
});

describe("the vetoes that must FIRE", () => {
  it("a Type I report cannot establish that a control OPERATED", () => {
    const e = evaluateVetoes(cleanInput({ reportType: "SOC 2 Type I" }));
    expect(stateOf(e, "report_type")).toBe("FIRED");
    expect(reasonOf(e, "report_type")).toBe("type_i_reports_design_only");
  });

  it("a governed INEFFECTIVE control is not coverage", () => {
    const e = evaluateVetoes(cleanInput({ governedEffectiveness: "INEFFECTIVE" }));
    expect(stateOf(e, "tested_control_result")).toBe("FIRED");
  });

  it("an interpreted exception linked to the control fires", () => {
    const e = evaluateVetoes(
      cleanInput({ linkedExceptions: [{ governedEffect: "control_deficiency" }] })
    );
    expect(stateOf(e, "control_exception")).toBe("FIRED");
  });

  it("an UNINTERPRETED linked exception is NOT_EVALUABLE, not passed", () => {
    const e = evaluateVetoes(cleanInput({ linkedExceptions: [{ governedEffect: null }] }));
    expect(stateOf(e, "control_exception")).toBe("NOT_EVALUABLE");
  });

  it("an AI-proposed mapping may never establish coverage", () => {
    const e = evaluateVetoes(cleanInput({ mappingSource: "ai_proposed" }));
    expect(stateOf(e, "mapping_authority")).toBe("FIRED");
    expect(reasonOf(e, "mapping_authority")).toBe("ai_proposed_mapping_cannot_establish_coverage");
  });

  it("an unpublished mapping fires, and an unapproved one fires", () => {
    expect(stateOf(evaluateVetoes(cleanInput({ mappingStatus: "draft" })), "mapping_authority")).toBe("FIRED");
    expect(stateOf(evaluateVetoes(cleanInput({ mappingApproved: false })), "mapping_authority")).toBe("FIRED");
  });

  it("a qualified or adverse opinion fires", () => {
    expect(stateOf(evaluateVetoes(cleanInput({ acceptedOpinion: "qualified" })), "accepted_opinion")).toBe("FIRED");
    expect(stateOf(evaluateVetoes(cleanInput({ acceptedOpinion: "adverse" })), "accepted_opinion")).toBe("FIRED");
  });

  it("an open finding on the same canonical control fires", () => {
    const e = evaluateVetoes(cleanInput({ openFindingsOnCanonicalControl: 2 }));
    expect(stateOf(e, "open_findings")).toBe("FIRED");
  });
});

describe("Ruling 6 — a clean opinion cannot erase an exception", () => {
  it("the exception veto fires independently of an unmodified opinion", () => {
    const e = evaluateVetoes(
      cleanInput({
        acceptedOpinion: "unmodified",
        linkedExceptions: [{ governedEffect: "control_deficiency" }],
      })
    );
    expect(stateOf(e, "accepted_opinion")).toBe("PASSED");
    expect(stateOf(e, "control_exception")).toBe("FIRED");
  });

  it("and an accepted EFFECTIVE Layer 2 does not clear it either", () => {
    const e = evaluateVetoes(
      cleanInput({
        governedEffectiveness: "EFFECTIVE",
        linkedExceptions: [{ governedEffect: "scope_limitation" }],
      })
    );
    expect(stateOf(e, "tested_control_result")).toBe("PASSED");
    expect(stateOf(e, "control_exception")).toBe("FIRED");
  });
});

describe("determinationPrecondition — the owner ruling, in code", () => {
  it("SUFFICIENT is refused while any veto FIRED", () => {
    const evals = evaluateVetoes(cleanInput({ reportType: "SOC 2 Type I" }));
    const p = determinationPrecondition("SUFFICIENT", evals);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.blocking.some((b) => b.veto === "report_type")).toBe(true);
  });

  it("SUFFICIENT is refused while any veto is NOT_EVALUABLE — no override", () => {
    const evals = evaluateVetoes(cleanInput({ contradictoryEvidenceQueryable: false }));
    const p = determinationPrecondition("SUFFICIENT", evals);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.blocking.some((b) => b.veto === "contradictory_evidence")).toBe(true);
      expect(p.blocking.every((b) => b.state !== "PASSED")).toBe(true);
    }
  });

  it("INSUFFICIENT and INDETERMINATE are always recordable", () => {
    const evals = evaluateVetoes(cleanInput({ contradictoryEvidenceQueryable: false }));
    expect(determinationPrecondition("INSUFFICIENT", evals).ok).toBe(true);
    expect(determinationPrecondition("INDETERMINATE", evals).ok).toBe(true);
  });

  it("SUFFICIENT is reachable only when EVERY veto passed", () => {
    const evals = evaluateVetoes(cleanInput());
    // Even the deliberately clean fixture cannot pass: report_period has no
    // ratified policy, so it is NOT_EVALUABLE by construction.
    expect(determinationPrecondition("SUFFICIENT", evals).ok).toBe(false);

    const allPassed: VetoEvaluation[] = EVALUATED_VETOES.map((veto) => ({
      veto,
      state: "PASSED" as const,
      reason: "synthetic",
    }));
    expect(determinationPrecondition("SUFFICIENT", allPassed).ok).toBe(true);
  });
});

describe("the platform's honest state today", () => {
  it("NO candidate can reach SUFFICIENT while ADR-0012 is unbuilt", () => {
    // Owner ruling: acceptable and expected. This test exists so that the day
    // it stops being true, somebody has to change it deliberately.
    const evals = evaluateVetoes(cleanInput({ contradictoryEvidenceQueryable: false }));
    const blocked = evals.filter((e) => e.state !== "PASSED").map((e) => e.veto);
    expect(blocked).toContain("contradictory_evidence");
    expect(blocked).toContain("report_period");
    expect(determinationPrecondition("SUFFICIENT", evals).ok).toBe(false);
  });
});

describe("buildDeterminationBasis", () => {
  it("records all TWELVE vetoes, including the two the schema guarantees", () => {
    const basis = buildDeterminationBasis(evaluateVetoes(cleanInput()), {});
    const vetoes = basis["vetoes"] as VetoEvaluation[];
    expect(vetoes).toHaveLength(12);
    expect(vetoes.map((v) => v.veto).sort()).toEqual([...COVERAGE_VETOES].sort());
    expect(vetoes.find((v) => v.veto === "human_acceptance")?.state).toBe("PASSED");
    expect(vetoes.find((v) => v.veto === "decision_basis")?.state).toBe("PASSED");
  });

  it("carries the counts the fail-closed CHECK reads, and they add up", () => {
    const basis = buildDeterminationBasis(evaluateVetoes(cleanInput()), {});
    const counts = basis["counts"] as Record<string, number>;
    expect(counts["passed"] + counts["fired"] + counts["not_evaluable"]).toBe(12);
  });

  it("always denies coverage, as recorded data rather than as a comment", () => {
    const basis = buildDeterminationBasis(evaluateVetoes(cleanInput()), {});
    expect(basis["establishes_requirement_coverage"]).toBe(false);
    expect(basis["evaluator_version"]).toBe(VETO_EVALUATOR_VERSION);
  });

  it("preserves the caller's context so the verdict stays reconstructable", () => {
    const basis = buildDeterminationBasis(evaluateVetoes(cleanInput()), {
      element_key: "CC6.1",
      crosswalk_id: "abc",
    });
    expect(basis["element_key"]).toBe("CC6.1");
    expect(basis["crosswalk_id"]).toBe("abc");
  });
});
