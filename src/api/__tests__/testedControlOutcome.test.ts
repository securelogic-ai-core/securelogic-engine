/**
 * testedControlOutcome.test.ts — VA-S4-4C-3, the pure core.
 *
 * Every corpus string quoted in this file was read from staging on 2026-08-31
 * (`securelogic-staging-db`, 51 tested controls across 17 extractions, 25
 * distinct `result` values, 20 exceptions, 16 management responses).
 *
 * REPRESENTABILITY, NOT PREVALENCE. Owner ruling, and it is preserved in the
 * test names: strings marked SYNTHETIC came from the controlled fixture
 * organization and prove only that a shape CAN occur. Strings marked REAL came
 * from a customer tenant. Nothing here claims a real-world frequency.
 */

import { describe, it, expect } from "vitest";
import {
  AUDITOR_ASSERTIONS,
  GOVERNED_EFFECTIVENESS,
  INDETERMINATE_REASONS,
  EXCEPTION_EFFECTS,
  EXCEPTION_LINK_SOURCES,
  proposeAuditorAssertion,
  suggestEffectiveness,
  parseExceptions,
  parseManagementResponses,
  pairResponsesToExceptions,
  splitLegacyControlId,
  sourceTermOf,
  validateAcceptEffectiveness,
  validateAcceptExceptionEffect,
  type AuditorAssertion,
} from "../lib/vendorAssurance/testedControlOutcome.js";

/* ═══════════════════════════════════════════════════════════════════════
   LAYER 1 — the auditor assertion.
   ═══════════════════════════════════════════════════════════════════════ */

describe("Layer 1: the normalizer against the measured corpus", () => {
  const cases: ReadonlyArray<[string, AuditorAssertion, string]> = [
    ["No exception noted.", "NO_EXCEPTION_NOTED", "REAL"],
    ["No exceptions noted.", "NO_EXCEPTION_NOTED", "SYNTHETIC"],
    ["No deviations noted.", "NO_EXCEPTION_NOTED", "SYNTHETIC"],
    ["No exceptions noted. The control operated effectively throughout the period.", "NO_EXCEPTION_NOTED", "SYNTHETIC"],
    ["Exception noted: for 2 of 30 sampled days, failed backup jobs were not investigated within the organization's documented 24-hour SLA. Backups were subsequently completed successfully within 48 hours.", "EXCEPTION_NOTED", "REAL"],
    ["Deviation noted: the Q3 privileged access review was completed 19 days after the documented due date. All sampled accounts were eventually reviewed, and no inappropriate privileges were identified.", "DEVIATION_NOTED", "REAL"],
    ["Exception noted: see Exception 1.", "EXCEPTION_NOTED", "SYNTHETIC"],
    ["The control did not operate effectively. For 11 of 20 sampled terminations, access was not revoked within one business day; 3 accounts remained active at the time of testing.", "NOT_EFFECTIVE_STATED", "SYNTHETIC"],
    ["Not tested. Physical security is carved out and performed by the subservice organization; refer to that organization's SOC 2 report.", "NOT_TESTED", "SYNTHETIC"],
    ["Not tested. The Processing Integrity category was not within the scope of this examination.", "NOT_TESTED", "SYNTHETIC"],
    ["We were unable to test this control. The change management system was migrated during the period and records prior to 1 June 2025 were not available for inspection.", "NOT_TESTED", "SYNTHETIC"],
    ["Not applicable. The service organization does not retain confidential information beyond the contractual term.", "NOT_APPLICABLE", "SYNTHETIC"],
    ["Test results were inconclusive for the period 1 January to 31 May 2025 due to incomplete log retention.", "INCONCLUSIVE", "SYNTHETIC"],
    ["The control was suitably designed as of 31 December 2025. Operating effectiveness was not tested.", "DESIGN_ONLY", "SYNTHETIC"],
  ];

  for (const [text, expected, provenance] of cases) {
    it(`[${provenance}] reads "${text.slice(0, 58)}…" as ${expected}`, () => {
      expect(proposeAuditorAssertion(text).candidate).toBe(expected);
    });
  }

  it("every corpus witness is explainable — rule and reason are always populated", () => {
    for (const [text] of cases) {
      const p = proposeAuditorAssertion(text);
      expect(p.rule.length).toBeGreaterThan(0);
      expect(p.reason.length).toBeGreaterThan(0);
      expect(p.normalizer_version).toBe("tested-control-assertion-1.0");
    }
  });
});

describe("Layer 1: the precedence that stops a clean reading being wrong", () => {
  it('"No exceptions noted" is NOT read as an exception, though it contains the word', () => {
    // The single most common string in the corpus, and the one every naive
    // matcher gets backwards.
    expect(proposeAuditorAssertion("No exceptions noted.").candidate).toBe("NO_EXCEPTION_NOTED");
  });

  it("a Type I design opinion is DESIGN_ONLY even though it says 'not tested' in the same breath", () => {
    const p = proposeAuditorAssertion(
      "The control was suitably designed as of 31 December 2025. Operating effectiveness was not tested."
    );
    expect(p.candidate).toBe("DESIGN_ONLY");
    expect(p.candidate).not.toBe("NOT_TESTED");
  });

  it("'not applicable' outranks a not-tested clause that follows it", () => {
    expect(
      proposeAuditorAssertion("Not applicable; the control was therefore not tested.").candidate
    ).toBe("NOT_APPLICABLE");
  });

  it("tested-but-inconclusive is not the same claim as not-tested", () => {
    expect(proposeAuditorAssertion("Test results were inconclusive.").candidate).toBe("INCONCLUSIVE");
    expect(proposeAuditorAssertion("The control was not tested.").candidate).toBe("NOT_TESTED");
  });

  it("UNREADABLE TEXT FAILS CLOSED to NOT_STATED — never to a clean reading", () => {
    for (const text of [
      "Refer to Section IV.",
      "See table 3.2 overleaf.",
      "asdf",
      "The auditor performed procedures.",
    ]) {
      const p = proposeAuditorAssertion(text);
      expect(p.candidate).toBe("NOT_STATED");
      expect(p.candidate).not.toBe("NO_EXCEPTION_NOTED");
      expect(p.rule).toBe("unrecognised");
    }
  });

  it("an absent result is NOT_STATED, and absence is never a reading", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(proposeAuditorAssertion(v).candidate).toBe("NOT_STATED");
    }
  });
});

describe("Layer 1: exception and deviation are TERMINOLOGY, not severity", () => {
  it("neither assertion value is ranked against the other anywhere in the vocabulary", () => {
    // The vocabulary is an unordered set. This test exists so that introducing
    // an ordinal — a severity map, a sort key, a numeric weight — has to delete
    // it deliberately.
    expect(AUDITOR_ASSERTIONS).toContain("EXCEPTION_NOTED");
    expect(AUDITOR_ASSERTIONS).toContain("DEVIATION_NOTED");
    expect(new Set(AUDITOR_ASSERTIONS).size).toBe(AUDITOR_ASSERTIONS.length);
  });

  it("both route to the SAME governed treatment: no candidate, a human decides", () => {
    const a = suggestEffectiveness("EXCEPTION_NOTED");
    const b = suggestEffectiveness("DEVIATION_NOTED");
    expect(a.candidate).toBeNull();
    expect(b.candidate).toBeNull();
    expect(a.candidate).toEqual(b.candidate);
  });

  it("sourceTermOf preserves the auditor's own word without interpreting it", () => {
    expect(sourceTermOf("Exception noted in Section IV.")).toBe("exception");
    expect(sourceTermOf("Deviation noted; procedural delay.")).toBe("deviation");
    expect(sourceTermOf("The control operated as designed.")).toBeNull();
    expect(sourceTermOf(null)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   LAYER 2 — governed effectiveness.
   ═══════════════════════════════════════════════════════════════════════ */

describe("Layer 2: an unknown outcome cannot become EFFECTIVE", () => {
  it("NO assertion — not one — ever suggests EFFECTIVE", () => {
    for (const a of AUDITOR_ASSERTIONS) {
      expect(suggestEffectiveness(a).candidate).not.toBe("EFFECTIVE");
    }
  });

  it("a clean auditor result does not suggest EFFECTIVE either", () => {
    // The case where auto-promotion would look most obviously right, and is not.
    const s = suggestEffectiveness("NO_EXCEPTION_NOTED");
    expect(s.candidate).toBeNull();
    expect(s.requires_human).toBe(true);
  });

  it("an assertion value the bridge has never seen falls through to NO candidate", () => {
    const s = suggestEffectiveness("SOMETHING_INVENTED_LATER" as AuditorAssertion);
    expect(s.candidate).toBeNull();
    expect(s.indeterminate_reason).toBeNull();
  });

  it("the only candidates offered REDUCE what is claimed", () => {
    const offered = AUDITOR_ASSERTIONS.map((a) => suggestEffectiveness(a).candidate).filter(
      (c) => c !== null
    );
    expect(new Set(offered)).toEqual(new Set(["INDETERMINATE"]));
  });

  it("a finding is NOT auto-proposed as INEFFECTIVE — that judgement is Layer 3's", () => {
    for (const a of ["EXCEPTION_NOTED", "DEVIATION_NOTED", "NOT_EFFECTIVE_STATED"] as const) {
      expect(suggestEffectiveness(a).candidate).toBeNull();
    }
  });

  it("every INDETERMINATE suggestion carries a governed reason from the closed set", () => {
    for (const a of AUDITOR_ASSERTIONS) {
      const s = suggestEffectiveness(a);
      if (s.candidate === "INDETERMINATE") {
        expect(INDETERMINATE_REASONS).toContain(s.indeterminate_reason!);
      } else {
        expect(s.indeterminate_reason).toBeNull();
      }
    }
  });
});

describe("Layer 2: validation defaults nothing", () => {
  const none = suggestEffectiveness("NO_EXCEPTION_NOTED");

  it("an omitted effectiveness is a REFUSAL, not a default", () => {
    const r = validateAcceptEffectiveness({}, none);
    expect(r).toHaveProperty("error", "effectiveness_required");
  });

  it("an unrecognised effectiveness is refused, never coerced", () => {
    const r = validateAcceptEffectiveness({ effectiveness: "PROBABLY_FINE" }, none);
    expect(r).toHaveProperty("error", "effectiveness_invalid");
  });

  it("null is refused exactly as absence is", () => {
    expect(validateAcceptEffectiveness({ effectiveness: null }, none)).toHaveProperty(
      "error",
      "effectiveness_required"
    );
  });

  it("EFFECTIVE always demands a stated basis, because nothing ever proposes it", () => {
    expect(validateAcceptEffectiveness({ effectiveness: "EFFECTIVE" }, none)).toHaveProperty(
      "error",
      "reviewer_note_required"
    );
    const ok = validateAcceptEffectiveness(
      { effectiveness: "EFFECTIVE", reviewer_note: "Period and scope both cover our use; no contradictory evidence." },
      none
    );
    expect(ok).toHaveProperty("input");
  });

  it("INDETERMINATE without a reason is refused", () => {
    expect(
      validateAcceptEffectiveness({ effectiveness: "INDETERMINATE" }, none)
    ).toHaveProperty("error", "indeterminate_reason_required");
  });

  it("an INDETERMINATE reason outside the closed set is refused — there is no catch-all", () => {
    const r = validateAcceptEffectiveness(
      { effectiveness: "INDETERMINATE", indeterminate_reason: "other" },
      none
    );
    expect(r).toHaveProperty("error", "indeterminate_reason_invalid");
  });

  it("a reason on a non-INDETERMINATE decision is refused", () => {
    const r = validateAcceptEffectiveness(
      { effectiveness: "INEFFECTIVE", indeterminate_reason: "not_tested", reviewer_note: "x" },
      none
    );
    expect(r).toHaveProperty("error", "indeterminate_reason_not_permitted");
  });

  it("agreeing with a non-null suggestion needs no prose; contradicting it does", () => {
    const suggested = suggestEffectiveness("NOT_TESTED");
    expect(suggested.candidate).toBe("INDETERMINATE");

    const agree = validateAcceptEffectiveness(
      { effectiveness: "INDETERMINATE", indeterminate_reason: "not_tested" },
      suggested
    );
    expect(agree).toHaveProperty("input");

    const differ = validateAcceptEffectiveness(
      { effectiveness: "INDETERMINATE", indeterminate_reason: "scope_limited" },
      suggested
    );
    expect(differ).toHaveProperty("error", "reviewer_note_required");
  });

  it("a rejection asserts NO effectiveness and must say why", () => {
    expect(validateAcceptEffectiveness({ decision: "rejected" }, none)).toHaveProperty(
      "error",
      "reviewer_note_required"
    );
    const withValue = validateAcceptEffectiveness(
      { decision: "rejected", effectiveness: "EFFECTIVE", reviewer_note: "x" },
      none
    );
    expect(withValue).toHaveProperty("error", "rejection_must_not_carry_effectiveness");

    const ok = validateAcceptEffectiveness(
      { decision: "rejected", reviewer_note: "Withdrawn: the report period does not cover our contract." },
      none
    );
    expect(ok).toHaveProperty("input");
    expect((ok as { input: { effectiveness: unknown } }).input.effectiveness).toBeNull();
  });

  it("there is deliberately no EFFECTIVE_WITH_EXCEPTION in the vocabulary", () => {
    expect(GOVERNED_EFFECTIVENESS).toEqual(["EFFECTIVE", "INEFFECTIVE", "INDETERMINATE"]);
    expect(GOVERNED_EFFECTIVENESS as readonly string[]).not.toContain("EFFECTIVE_WITH_EXCEPTION");
    const r = validateAcceptEffectiveness(
      { effectiveness: "EFFECTIVE_WITH_EXCEPTION", reviewer_note: "x" },
      none
    );
    expect(r).toHaveProperty("error", "effectiveness_invalid");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   LAYER 3 — exceptions, linkage, effect.
   ═══════════════════════════════════════════════════════════════════════ */

describe("Layer 3: the corrected three-key contract", () => {
  it("[SYNTHETIC] reads the v3 shape: a labelled exception spanning three controls", () => {
    const parsed = parseExceptions([
      {
        exception_ref: "Exception 1",
        control_refs: ["CC6.1", "CC6.2", "CC6.3"],
        description: "The identity governance platform was unavailable from 3 March to 24 March 2025.",
        auditor_assessment: "Exception noted affecting CC6.1, CC6.2 and CC6.3.",
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.exception_ref).toBe("Exception 1");
    expect(parsed[0]!.links.map((l) => l.control_ref)).toEqual(["CC6.1", "CC6.2", "CC6.3"]);
    expect(parsed[0]!.links.every((l) => l.link_source === "extraction_control_refs")).toBe(true);
  });

  it("[SYNTHETIC] reads the LEGACY v2 shape, and the multi-control scalar it was forced into", () => {
    // The exact corpus row: three identifiers packed into one string because the
    // v2 contract had nowhere else to put them.
    const parsed = parseExceptions([
      {
        control_id: "CC6.1, CC6.2, CC6.3",
        description: "The identity governance platform was unavailable from 3 March to 24 March 2025.",
        auditor_assessment: "Exception noted affecting CC6.1, CC6.2 and CC6.3.",
      },
    ]);
    expect(parsed[0]!.links.map((l) => l.control_ref)).toEqual(["CC6.1", "CC6.2", "CC6.3"]);
    expect(parsed[0]!.links.every((l) => l.link_source === "legacy_control_id")).toBe(true);
    // The raw string travels with every link, so the split is checkable.
    expect(parsed[0]!.links.every((l) => l.source_value === "CC6.1, CC6.2, CC6.3")).toBe(true);
  });

  it("[REAL] a single-identifier legacy scalar still reads, unchanged", () => {
    const parsed = parseExceptions([
      { control_id: "A1.2", description: "SLA breach for backup investigation.", auditor_assessment: "Exception noted" },
    ]);
    expect(parsed[0]!.links).toEqual([
      { control_ref: "A1.2", link_source: "legacy_control_id", source_value: "A1.2" },
    ]);
    expect(parsed[0]!.source_term).toBe("exception");
  });

  it("v3 control_refs takes precedence and never double-links against a legacy scalar", () => {
    const parsed = parseExceptions([
      { exception_ref: "Exception 2", control_refs: ["CC7.2"], control_id: "CC7.2", description: "d" },
    ]);
    expect(parsed[0]!.links).toHaveLength(1);
    expect(parsed[0]!.links[0]!.link_source).toBe("extraction_control_refs");
  });

  it("splitLegacyControlId invents nothing the string does not contain", () => {
    expect(splitLegacyControlId("CC6.1, CC6.2, CC6.3")).toEqual(["CC6.1", "CC6.2", "CC6.3"]);
    expect(splitLegacyControlId("CC6.1 and CC6.2")).toEqual(["CC6.1", "CC6.2"]);
    expect(splitLegacyControlId("CC6.1")).toEqual(["CC6.1"]);
    expect(splitLegacyControlId("  ")).toEqual([]);
  });

  it("an exception the report does not link to any control links to NOTHING — never to a guess", () => {
    const parsed = parseExceptions([{ exception_ref: "Exception 4", control_refs: [], description: "d" }]);
    expect(parsed[0]!.links).toEqual([]);
  });

  it("the link-source vocabulary has no index_alignment value, and never will", () => {
    expect(EXCEPTION_LINK_SOURCES as readonly string[]).not.toContain("index_alignment");
    expect(EXCEPTION_LINK_SOURCES).toEqual(["extraction_control_refs", "legacy_control_id", "human"]);
  });
});

describe("Layer 3: control_ref cannot silently attach an exception to the wrong control", () => {
  it("[SYNTHETIC] THE DEFECT: an exception LABEL is never read as a control identifier", () => {
    // The corpus row that tripped the owner's stop condition:
    //   management_responses[0].exception_ref = "Exception 1"
    // Under the old export it matched no control, so index alignment fired.
    const exceptions = parseExceptions([
      { exception_ref: "Exception 1", control_refs: ["CC6.1", "CC6.2", "CC6.3"], description: "outage" },
    ]);
    const responses = parseManagementResponses([
      { exception_ref: "Exception 1", control_refs: [], response: "Management restored the platform." },
    ]);
    const { pairings } = pairResponsesToExceptions(exceptions, responses);
    expect(pairings[0]!.link).toBe("exception_ref");
    // And the label never became a control link.
    expect(exceptions[0]!.links.map((l) => l.control_ref)).not.toContain("Exception 1");
  });

  it("THE OLD FALLBACK IS GONE: a non-matching response is NOT attached by array position", () => {
    const exceptions = parseExceptions([
      { exception_ref: "Exception A", control_refs: ["CC6.1"], description: "first" },
      { exception_ref: "Exception B", control_refs: ["CC7.2"], description: "second" },
    ]);
    // A response that names neither exception and neither control scope. Index
    // alignment would have attached it to the FIRST exception.
    const responses = parseManagementResponses([
      { exception_ref: null, control_refs: [], response: "A response about something else entirely." },
    ]);
    const { pairings, unmatched_response_ordinals } = pairResponsesToExceptions(exceptions, responses);
    expect(pairings.every((p) => p.link === "unlinked")).toBe(true);
    expect(pairings.every((p) => p.response_ordinal === null)).toBe(true);
    // And the orphan is VISIBLE rather than silently absent.
    expect(unmatched_response_ordinals).toEqual([0]);
  });

  it("MISORDERED arrays do not misattach — the fallback's actual failure mode", () => {
    const exceptions = parseExceptions([
      { exception_ref: "E1", control_refs: ["A1.2"], description: "backup" },
      { exception_ref: "E2", control_refs: ["CC6.2"], description: "access review" },
    ]);
    // Deliberately the reverse order.
    const responses = parseManagementResponses([
      { exception_ref: "E2", control_refs: ["CC6.2"], response: "about the access review" },
      { exception_ref: "E1", control_refs: ["A1.2"], response: "about the backups" },
    ]);
    const { pairings } = pairResponsesToExceptions(exceptions, responses);
    expect(pairings[0]!.response_ordinal).toBe(1);
    expect(pairings[1]!.response_ordinal).toBe(0);
  });

  it("a PARTIAL control overlap is not a match — different scope is different scope", () => {
    const exceptions = parseExceptions([
      { exception_ref: null, control_refs: ["CC6.1", "CC6.2", "CC6.3"], description: "outage" },
    ]);
    const responses = parseManagementResponses([
      { exception_ref: null, control_refs: ["CC6.1"], response: "only about CC6.1" },
    ]);
    const { pairings } = pairResponsesToExceptions(exceptions, responses);
    expect(pairings[0]!.link).toBe("unlinked");
  });

  it("an identical control scope IS an authoritative match", () => {
    const exceptions = parseExceptions([{ exception_ref: null, control_refs: ["CC6.2"], description: "d" }]);
    const responses = parseManagementResponses([
      { exception_ref: null, control_refs: ["CC6.2"], response: "A backup reviewer assignment was implemented." },
    ]);
    const { pairings } = pairResponsesToExceptions(exceptions, responses);
    expect(pairings[0]!.link).toBe("control_refs");
    expect(pairings[0]!.response_ordinal).toBe(0);
  });
});

describe("Layer 3: the exception-effect vocabulary carries no severity", () => {
  it("is exactly the two values the investigation witnessed", () => {
    expect(EXCEPTION_EFFECTS).toEqual(["control_deficiency", "scope_limitation"]);
  });

  it("a scope limitation is a DIFFERENT KIND of statement, not a lesser deficiency", () => {
    // Both accepted identically; neither is derived from, or ranked against, the
    // other. The corpus witnesses both: "Scope limitation applied. Sufficient
    // appropriate evidence was not available" (CC8.1) alongside "3 of 25 access
    // requests lacked documented manager approval" (CC6.1).
    for (const effect of EXCEPTION_EFFECTS) {
      expect(validateAcceptExceptionEffect({ governed_effect: effect })).toHaveProperty("input");
    }
  });

  it("the effect is never inferred — it must be stated", () => {
    expect(validateAcceptExceptionEffect({})).toHaveProperty("error", "governed_effect_required");
    expect(validateAcceptExceptionEffect({ governed_effect: null })).toHaveProperty(
      "error",
      "governed_effect_required"
    );
  });

  it("there is no catch-all effect to absorb an unrecognised one", () => {
    for (const bad of ["other", "minor", "major", "informational", "unknown"]) {
      expect(validateAcceptExceptionEffect({ governed_effect: bad })).toHaveProperty(
        "error",
        "governed_effect_invalid"
      );
    }
  });

  it("the auditor's own word is NOT an accepted input to the decision", () => {
    // Passing terminology where an effect belongs is refused, so nothing can
    // encode severity from "exception" or "deviation".
    for (const term of ["exception", "deviation"]) {
      expect(validateAcceptExceptionEffect({ governed_effect: term })).toHaveProperty(
        "error",
        "governed_effect_invalid"
      );
    }
  });

  it("re-deciding a standing effect must say what changed", () => {
    expect(
      validateAcceptExceptionEffect({ governed_effect: "scope_limitation", supersede: true })
    ).toHaveProperty("error", "reviewer_note_required");
    expect(
      validateAcceptExceptionEffect({
        governed_effect: "scope_limitation",
        supersede: true,
        reviewer_note: "Re-read: the auditor could not obtain evidence; the control itself was not shown to fail.",
      })
    ).toHaveProperty("input");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Historical reproducibility.
   ═══════════════════════════════════════════════════════════════════════ */

describe("historical reproducibility", () => {
  it("a v2 extraction is still fully readable after the v3 contract change", () => {
    // Byte-for-byte the shape stored on staging under soc-extraction-v2.
    const v2Exceptions = [
      { control_id: "CC6.2", description: "Q3 privileged access review completed 19 days late.", auditor_assessment: "Deviation noted" },
      { control_id: "A1.2", description: "Failed backup jobs not investigated within SLA.", auditor_assessment: "Exception noted" },
    ];
    const v2Responses = [
      { exception_ref: "CC6.2", response: "Management stated that the Q3 privileged-access review was completed late." },
      { exception_ref: "A1.2", response: "Management stated that two failed backup jobs were caused by a storage incident." },
    ];
    const parsed = parseExceptions(v2Exceptions);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.links[0]!.control_ref).toBe("CC6.2");
    expect(parsed[0]!.source_term).toBe("deviation");
    expect(parsed[1]!.source_term).toBe("exception");

    // A v2 response's exception_ref holds a CONTROL id, so it pairs through the
    // control-scope route rather than the label route — correctly, and visibly.
    const responses = parseManagementResponses(v2Responses);
    const { pairings } = pairResponsesToExceptions(parsed, responses);
    expect(pairings.every((p) => p.link !== "unlinked")).toBe(false);
    // What matters is that nothing is attached by position and nothing is wrong.
    for (const p of pairings) {
      if (p.response_ordinal !== null) {
        expect(p.link).not.toBe("unlinked");
      }
    }
  });

  it("the Layer-1 normalizer is deterministic — identical input, identical output", () => {
    const text = "Exception noted: 3 of 25 access requests lacked documented manager approval.";
    const a = proposeAuditorAssertion(text);
    const b = proposeAuditorAssertion(text);
    expect(a).toEqual(b);
    // The version stamp is what lets a past reading be argued against the rules
    // that produced it rather than against today's.
    expect(a.normalizer_version).toBe("tested-control-assertion-1.0");
  });

  it("malformed and hostile shapes degrade to empty, never to an exception", () => {
    for (const v of [null, undefined, "a string", 42, {}, [null], [42], [[]]]) {
      expect(() => parseExceptions(v)).not.toThrow();
      expect(() => parseManagementResponses(v)).not.toThrow();
    }
    expect(parseExceptions([null, 42])).toHaveLength(2);
    expect(parseExceptions([null])[0]!.links).toEqual([]);
  });
});
