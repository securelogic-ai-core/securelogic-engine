/**
 * C4 / ADR-0003 D1 — the evidence gate, expressed as numbers.
 *
 * ERG R2 permits `affected` only on a HIGH-CONFIDENCE, EXPLAINABLE match to a tenant
 * asset. ApplicabilityEngineV1's `matchThresholds.high` is 70. So the confidence a
 * resolver assigns to an asset↔product identity IS the gate — everything at or above 70
 * can support `affected`; everything below it cannot, however tidy the string match looked.
 *
 * Before C4 the ONLY match path was `canonicalizeVendorName(asset.name) === product` and
 * it scored **100** — meaning the product could assert `affected` because a customer
 * happened to name an asset "Exchange". That is the inference R2 exists to forbid.
 */
import { describe, it, expect } from "vitest";
import { IDENTITY_CONFIDENCE, TENANT_ASSET_RESOLVER_VERSION } from "../lib/tenantAssetResolver.js";
import { DEFAULT_APPLICABILITY_POLICY } from "../../engine/applicability/v1/applicabilityPolicy.js";

const HIGH = DEFAULT_APPLICABILITY_POLICY.matchThresholds.high;

describe("asset↔product identity confidence IS the R2 evidence gate", () => {
  it("EVIDENCE can support `affected` — it clears the engine's high threshold", () => {
    expect(IDENTITY_CONFIDENCE.attestation).toBeGreaterThanOrEqual(HIGH);
    expect(IDENTITY_CONFIDENCE.sbom).toBeGreaterThanOrEqual(HIGH);
    expect(IDENTITY_CONFIDENCE.connector).toBeGreaterThanOrEqual(HIGH);
  });

  it("a NAME COINCIDENCE cannot — it is below the high threshold, deliberately", () => {
    // "We own something called Exchange" is a coincidence, not evidence. It may raise
    // `potentially_affected`. It may never assert `affected`. This single number is what
    // stops C4 from manufacturing false positives at scale.
    expect(IDENTITY_CONFIDENCE.inferred).toBeLessThan(HIGH);
  });

  it("authority is ordered: human attestation >= machine evidence > inference", () => {
    // ADR-0003 D1: attestation is an OVERRIDE — supporting evidence that may strengthen
    // applicability. It outranks machine evidence; it does not replace canonical context.
    expect(IDENTITY_CONFIDENCE.attestation).toBeGreaterThanOrEqual(IDENTITY_CONFIDENCE.sbom);
    expect(IDENTITY_CONFIDENCE.sbom).toBeGreaterThanOrEqual(IDENTITY_CONFIDENCE.connector);
    expect(IDENTITY_CONFIDENCE.connector).toBeGreaterThan(IDENTITY_CONFIDENCE.inferred);
  });

  it("every provenance the migration's CHECK admits has a confidence", () => {
    // If a provenance is added to asset_product_identities without a score here, the
    // resolver would silently score it `undefined` — i.e. ungated.
    for (const p of ["attestation", "sbom", "connector", "inferred"]) {
      expect(typeof IDENTITY_CONFIDENCE[p]).toBe("number");
    }
  });

  it("the resolver version was bumped — its match semantics changed", () => {
    expect(TENANT_ASSET_RESOLVER_VERSION).not.toBe("tar-v1.0.0");
  });
});
