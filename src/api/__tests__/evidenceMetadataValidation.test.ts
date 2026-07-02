/**
 * evidenceMetadataValidation.test.ts — Epic R4.
 *
 * Covers (1) the extracted source-agnostic metadata validator reused by the
 * risk-scoped evidence route, and (2) the drift reconciliation that adds
 * 'policy_review' to the accepted source types (it was in the DB CHECK +
 * SOURCE_TYPE_TABLE but rejected by the validator).
 */
import { describe, it, expect } from "vitest";
import {
  validateEvidenceMetadata,
  validateEvidenceCreate,
  VALID_SOURCE_TYPES,
} from "../lib/evidenceValidation.js";

const SRC = "22222222-2222-4222-8222-222222222222";

describe("validateEvidenceMetadata (R4 shared validator)", () => {
  it("accepts a minimal valid record (title + evidence_type)", () => {
    const r = validateEvidenceMetadata({ title: "SOC 2", evidence_type: "document" });
    expect("metadata" in r).toBe(true);
    if ("metadata" in r) {
      expect(r.metadata.title).toBe("SOC 2");
      expect(r.metadata.description).toBeNull();
      expect(r.metadata.collected_at).toBeNull();
    }
  });

  it("requires a non-empty title", () => {
    const r = validateEvidenceMetadata({ evidence_type: "document" });
    expect(r).toMatchObject({ error: "title_required" });
  });

  it("rejects an invalid evidence_type", () => {
    const r = validateEvidenceMetadata({ title: "x", evidence_type: "banana" });
    expect(r).toMatchObject({ error: "invalid_evidence_type" });
  });

  it("rejects a malformed collected_at", () => {
    const r = validateEvidenceMetadata({ title: "x", evidence_type: "document", collected_at: "07/02/2026" });
    expect(r).toMatchObject({ error: "collected_at_invalid_format" });
  });

  it("does NOT require source_type/source_id (those come from the URL)", () => {
    const r = validateEvidenceMetadata({ title: "x", evidence_type: "document" });
    expect("metadata" in r).toBe(true);
  });
});

describe("drift reconciliation — policy_review", () => {
  it("VALID_SOURCE_TYPES now includes policy_review (was in DB CHECK + table map)", () => {
    expect(VALID_SOURCE_TYPES.has("policy_review")).toBe(true);
  });

  it("validateEvidenceCreate accepts a policy_review record end-to-end", () => {
    const r = validateEvidenceCreate({
      source_type: "policy_review",
      source_id: SRC,
      title: "Policy attestation",
      evidence_type: "policy",
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.source_type).toBe("policy_review");
  });

  it("does NOT accept source_type='risk' on the generic route (risk uses its own flag-gated routes)", () => {
    expect(VALID_SOURCE_TYPES.has("risk")).toBe(false);
    const r = validateEvidenceCreate({ source_type: "risk", source_id: SRC, title: "x", evidence_type: "document" });
    expect(r).toMatchObject({ error: "invalid_source_type" });
  });
});
