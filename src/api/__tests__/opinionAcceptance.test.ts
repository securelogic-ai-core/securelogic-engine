/**
 * opinionAcceptance.test.ts — VA-S4-P2 (step 4b), the pure half.
 *
 * Body validation and decision-basis construction. The route-level guards,
 * tenancy and audit trail are asserted in vendorAssuranceOpinionAcceptance.test.ts;
 * what is asserted here is the part that must hold with no request at all.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_OPINION_REVIEWER_NOTE,
  MAX_OPINION_SOURCE_TEXT,
  buildOpinionAcceptanceBasis,
  validateAcceptOpinionBody,
} from "../lib/vendorAssurance/opinionAcceptance.js";
import { proposeAssuranceOpinion } from "../lib/vendorAssurance/assuranceOpinion.js";

const STAGING_OPINION =
  "Unqualified opinion, except for the specific deviations and exception described in Section IV";

const PROPOSAL = proposeAssuranceOpinion(STAGING_OPINION);

describe("validateAcceptOpinionBody", () => {
  it("rejects a non-object body", () => {
    expect(validateAcceptOpinionBody("qualified", "qualified")).toMatchObject({
      error: "request_body_must_be_object",
    });
    expect(validateAcceptOpinionBody(["qualified"], "qualified")).toMatchObject({
      error: "request_body_must_be_object",
    });
  });

  it("rejects anything outside the closed vocabulary", () => {
    for (const v of ["clean", "UNMODIFIED", "", null, 3, undefined]) {
      expect(validateAcceptOpinionBody({ opinion: v }, "qualified")).toMatchObject({
        error: "invalid_assurance_opinion",
      });
    }
  });

  it("accepts the candidate with no note — agreement needs no defence", () => {
    const r = validateAcceptOpinionBody({ opinion: "qualified" }, "qualified");
    expect(r).toEqual({ input: { opinion: "qualified", reviewer_note: null, supersede: false } });
  });

  it("requires a note when the human departs from the candidate", () => {
    const r = validateAcceptOpinionBody({ opinion: "unmodified" }, "qualified");
    expect(r).toMatchObject({ error: "reviewer_note_required_for_override" });
    // The message names both values, so the reviewer sees what they are overruling.
    expect((r as { detail: string }).detail).toMatch(/qualified/);
    expect((r as { detail: string }).detail).toMatch(/unmodified/);
  });

  it("treats a whitespace-only note as no note", () => {
    expect(
      validateAcceptOpinionBody({ opinion: "unmodified", reviewer_note: "   \n\t " }, "qualified")
    ).toMatchObject({ error: "reviewer_note_required_for_override" });
  });

  it("requires a note on supersede even when the value matches the candidate", () => {
    expect(
      validateAcceptOpinionBody({ opinion: "qualified", supersede: true }, "qualified")
    ).toMatchObject({ error: "reviewer_note_required_for_supersede" });
  });

  it("rejects a non-boolean supersede rather than coercing it", () => {
    // "false" is truthy; coercion here would turn a typo into a silent
    // re-decision of a governed determination.
    expect(
      validateAcceptOpinionBody({ opinion: "qualified", supersede: "false" }, "qualified")
    ).toMatchObject({ error: "supersede_must_be_boolean" });
  });

  it("rejects a non-string reviewer_note", () => {
    expect(
      validateAcceptOpinionBody({ opinion: "qualified", reviewer_note: 42 }, "qualified")
    ).toMatchObject({ error: "reviewer_note_must_be_string" });
  });

  it("caps an oversized reviewer note rather than passing it through", () => {
    const r = validateAcceptOpinionBody(
      { opinion: "adverse", reviewer_note: "note ".repeat(2000) },
      "qualified"
    );
    const note = (r as { input: { reviewer_note: string } }).input.reviewer_note;
    expect(note.length).toBeLessThanOrEqual(MAX_OPINION_REVIEWER_NOTE);
  });

  it("never reads an organization from the body", () => {
    const r = validateAcceptOpinionBody(
      { opinion: "qualified", organization_id: "11111111-1111-4111-8111-111111111111" },
      "qualified"
    );
    expect(Object.keys((r as { input: object }).input).sort()).toEqual([
      "opinion",
      "reviewer_note",
      "supersede",
    ]);
  });
});

describe("buildOpinionAcceptanceBasis", () => {
  const base = {
    acceptedAt: "2026-08-30T12:00:00.000Z",
    acceptedByUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    proposal: PROPOSAL,
    sourceText: STAGING_OPINION,
    sourceOrigin: "extraction" as const,
    extractionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    documentStatus: "approved",
    documentApprovedAt: "2026-08-30T10:00:00Z",
    documentApprovedByUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    reviewerNote: null,
    priorAcceptance: null,
  };

  it("records agreement when the human accepts the candidate", () => {
    const b = buildOpinionAcceptanceBasis({ ...base, accepted: "qualified" });
    expect(b["human_agreed_with_candidate"]).toBe(true);
    expect(b["coverage_gate_at_acceptance"]).toBe("conditional");
  });

  it("records DISAGREEMENT when the human overrules it", () => {
    const b = buildOpinionAcceptanceBasis({
      ...base,
      accepted: "unmodified",
      reviewerNote: "the deviation is in a service we do not consume",
    });
    expect(b["human_agreed_with_candidate"]).toBe(false);
    expect((b["proposal"] as Record<string, unknown>)["candidate"]).toBe("qualified");
    expect(b["accepted_opinion"]).toBe("unmodified");
  });

  it("states establishes_requirement_coverage: false in the ROW, on every value", () => {
    // Owner ruling, 2026-08-30. Not a comment — part of the record, including
    // for `unmodified`, the most permissive value in the vocabulary.
    for (const v of ["unmodified", "qualified", "adverse", "disclaimer", "not_evaluated"] as const) {
      const b = buildOpinionAcceptanceBasis({ ...base, accepted: v, reviewerNote: "x" });
      expect(b["establishes_requirement_coverage"]).toBe(false);
    }
  });

  it("snapshots the source text by value, capped", () => {
    const b = buildOpinionAcceptanceBasis({
      ...base,
      accepted: "qualified",
      sourceText: "x".repeat(MAX_OPINION_SOURCE_TEXT + 500),
    });
    const text = (b["source"] as Record<string, string>)["auditor_opinion_text"]!;
    expect(text.length).toBe(MAX_OPINION_SOURCE_TEXT);
  });

  it("carries an absent source honestly rather than inventing one", () => {
    const b = buildOpinionAcceptanceBasis({
      ...base,
      accepted: "not_evaluated",
      sourceText: null,
      sourceOrigin: "absent",
      extractionId: null,
    });
    expect((b["source"] as Record<string, unknown>)["auditor_opinion_text"]).toBeNull();
    expect((b["source"] as Record<string, unknown>)["origin"]).toBe("absent");
    // Absence is never coverage.
    expect(b["coverage_gate_at_acceptance"]).toBe("ineligible");
  });

  it("omits `supersedes` on a first acceptance and carries it on a re-decision", () => {
    expect(
      buildOpinionAcceptanceBasis({ ...base, accepted: "qualified" })["supersedes"]
    ).toBeUndefined();
    const b = buildOpinionAcceptanceBasis({
      ...base,
      accepted: "adverse",
      reviewerNote: "re-read Section IV",
      priorAcceptance: {
        opinion: "qualified",
        accepted_by_user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        accepted_at: "2026-08-30T11:00:00Z",
        reviewer_note: "carve-out applies",
      },
    });
    expect(b["supersedes"]).toMatchObject({
      opinion: "qualified",
      reviewer_note: "carve-out applies",
    });
  });

  it("is pure: the same arguments produce the same basis", () => {
    // No clock read, no randomness — a basis must be reproducible from its
    // inputs, or it cannot be checked against the audit event.
    const a = buildOpinionAcceptanceBasis({ ...base, accepted: "qualified" });
    const b = buildOpinionAcceptanceBasis({ ...base, accepted: "qualified" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
