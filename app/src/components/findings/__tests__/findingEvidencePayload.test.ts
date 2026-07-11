/**
 * The evidence-gate deadlock guard.
 *
 * An org with require_evidence_gate on cannot move a finding to `remediated`
 * without an evidence row whose source_type is exactly "finding" and whose
 * source_id is the finding's id (findingLifecycle.ts:97-108). If either drifts,
 * POST /api/evidence 404s, no row is written, and the finding stays stuck — with
 * no error the user can see. These tests pin that contract.
 */
import { describe, it, expect } from "vitest";
import {
  buildFindingEvidencePayload,
  isValidEvidenceType,
  EVIDENCE_TYPES,
} from "../findingEvidencePayload";

const FINDING = "44444444-4444-4444-8444-444444444444";

describe("buildFindingEvidencePayload — the gate contract", () => {
  it("pins source_type to the literal 'finding' the engine resolves to findings", () => {
    const p = buildFindingEvidencePayload(FINDING, {
      title: "Patch deployment log",
      evidence_type: "log",
    });
    // Not "findings", not "Finding" — the engine's SOURCE_TYPE_TABLE key.
    expect(p.source_type).toBe("finding");
  });

  it("carries the finding id as source_id, so the gate's EXISTS check can see it", () => {
    const p = buildFindingEvidencePayload(FINDING, {
      title: "Change ticket CHG-10442",
      evidence_type: "document",
    });
    expect(p.source_id).toBe(FINDING);
  });

  it("refuses a blank title rather than letting the CHECK constraint 400 it", () => {
    expect(() =>
      buildFindingEvidencePayload(FINDING, { title: "   ", evidence_type: "document" })
    ).toThrow(/title is required/i);
  });

  it("trims the title (a padded title is not a distinct title)", () => {
    const p = buildFindingEvidencePayload(FINDING, {
      title: "  Screenshot of MFA enforcement  ",
      evidence_type: "screenshot",
    });
    expect(p.title).toBe("Screenshot of MFA enforcement");
  });

  it("collapses omitted and blank optional fields to null, never empty string", () => {
    const omitted = buildFindingEvidencePayload(FINDING, {
      title: "t",
      evidence_type: "other",
    });
    expect(omitted.external_ref).toBeNull();
    expect(omitted.description).toBeNull();

    const blank = buildFindingEvidencePayload(FINDING, {
      title: "t",
      evidence_type: "other",
      external_ref: "   ",
      description: "",
    });
    expect(blank.external_ref).toBeNull();
    expect(blank.description).toBeNull();
  });

  it("preserves a real external_ref", () => {
    const p = buildFindingEvidencePayload(FINDING, {
      title: "t",
      evidence_type: "document",
      external_ref: "  https://tickets/CHG-10442  ",
    });
    expect(p.external_ref).toBe("https://tickets/CHG-10442");
  });
});

describe("isValidEvidenceType — mirrors the evidence_type CHECK constraint", () => {
  it("accepts every canonical type", () => {
    for (const t of EVIDENCE_TYPES) expect(isValidEvidenceType(t)).toBe(true);
  });

  it("rejects anything the constraint would reject", () => {
    expect(isValidEvidenceType("attachment")).toBe(false);
    expect(isValidEvidenceType("Document")).toBe(false);
    expect(isValidEvidenceType("")).toBe(false);
  });
});
