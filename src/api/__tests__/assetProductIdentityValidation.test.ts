/**
 * C4 part 2 / ADR-0003 D1-B — the attestation write path's security invariants.
 *
 * Confidence is keyed to provenance (tenantAssetResolver.IDENTITY_CONFIDENCE), and that
 * confidence is the ERG R2 gate deciding whether a finding may be called `affected`.
 * So the two fields a caller must NEVER control are `provenance` and `confidence` — a
 * client that could set either could talk its way past the evidence gate.
 */
import { describe, it, expect } from "vitest";
import {
  validateAttestationCreate,
  HUMAN_PROVENANCE,
  ALL_PROVENANCES,
} from "../lib/assetProductIdentityValidation.js";
import { IDENTITY_CONFIDENCE } from "../lib/tenantAssetResolver.js";
import { DEFAULT_APPLICABILITY_POLICY } from "../../engine/applicability/v1/applicabilityPolicy.js";

const ASSET = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const ok = { asset_id: ASSET, canonical_product_id: PRODUCT };

describe("a human may only ever write an attestation", () => {
  it("REJECTS a client-supplied provenance — machine evidence cannot be forged", () => {
    // The attack: post provenance='sbom' and inherit its 95 confidence, clearing the
    // R2 gate (70) on an opinion. The field is not an input; supplying it is an error,
    // not something we silently ignore.
    for (const forged of ["sbom", "connector", "inferred", "attestation"]) {
      const r = validateAttestationCreate({ ...ok, provenance: forged });
      expect(r).toHaveProperty("error", "provenance_not_settable");
    }
  });

  it("REJECTS a client-supplied confidence — the gate is not negotiable", () => {
    const r = validateAttestationCreate({ ...ok, confidence: 100 });
    expect(r).toHaveProperty("error", "confidence_not_settable");
  });

  it("the human provenance is exactly 'attestation'", () => {
    expect(HUMAN_PROVENANCE).toBe("attestation");
    expect(ALL_PROVENANCES).toContain(HUMAN_PROVENANCE);
  });

  it("an attestation clears the R2 gate — a person's explicit declaration IS evidence", () => {
    expect(IDENTITY_CONFIDENCE[HUMAN_PROVENANCE]).toBeGreaterThanOrEqual(
      DEFAULT_APPLICABILITY_POLICY.matchThresholds.high
    );
  });
});

describe("input validation", () => {
  it("accepts a well-formed attestation", () => {
    const r = validateAttestationCreate({ ...ok, evidence_ref: "  CHG-10442  " });
    expect(r).toEqual({
      input: { asset_id: ASSET, canonical_product_id: PRODUCT, evidence_ref: "CHG-10442" },
    });
  });

  it("evidence_ref is optional, and blank collapses to null (not an empty string)", () => {
    expect(validateAttestationCreate(ok)).toEqual({
      input: { asset_id: ASSET, canonical_product_id: PRODUCT, evidence_ref: null },
    });
    const blank = validateAttestationCreate({ ...ok, evidence_ref: "   " });
    expect(blank).toHaveProperty("input.evidence_ref", null);
  });

  it("rejects non-uuid ids rather than letting them reach the database", () => {
    expect(validateAttestationCreate({ ...ok, asset_id: "nope" })).toHaveProperty(
      "error",
      "invalid_asset_id"
    );
    expect(
      validateAttestationCreate({ ...ok, canonical_product_id: "'; DROP TABLE assets--" })
    ).toHaveProperty("error", "invalid_canonical_product_id");
  });

  it("bounds evidence_ref", () => {
    expect(
      validateAttestationCreate({ ...ok, evidence_ref: "x".repeat(501) })
    ).toHaveProperty("error", "invalid_evidence_ref");
    expect(validateAttestationCreate({ ...ok, evidence_ref: 42 })).toHaveProperty(
      "error",
      "invalid_evidence_ref"
    );
  });

  it("rejects a non-object body", () => {
    expect(validateAttestationCreate(null)).toHaveProperty("error", "invalid_body");
    expect(validateAttestationCreate("hi")).toHaveProperty("error", "invalid_body");
  });
});
