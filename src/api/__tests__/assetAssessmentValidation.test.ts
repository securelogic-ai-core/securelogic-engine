/**
 * assetAssessmentValidation.test.ts — EAR P10: pure validation for the
 * generic asset-assessment routes. Mirrors the obligation-workflow test
 * conventions (the template stack), generalized to the AssetRef subject.
 */

import { describe, expect, it } from "vitest";

import {
  validateAssetAssessmentCreate,
  validateAssetAssessmentStatusTransition,
  isValidTransition,
  TERMINAL_STATUSES,
  FINDING_STATUSES
} from "../lib/assetAssessmentValidation.js";

const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE = { asset_type: "endpoint", asset_id: ASSET_ID };

describe("validateAssetAssessmentCreate — body & AssetRef", () => {
  it("rejects non-object bodies", () => {
    for (const body of [null, undefined, "x", 42, []]) {
      expect(validateAssetAssessmentCreate(body)).toEqual({ error: "request_body_required" });
    }
  });

  it("requires asset_type from the registry vocabulary", () => {
    expect(validateAssetAssessmentCreate({ asset_id: ASSET_ID })).toEqual({
      error: "asset_type_required"
    });
    const bad = validateAssetAssessmentCreate({ asset_type: "mainframe", asset_id: ASSET_ID });
    expect(bad).toMatchObject({ error: "invalid_asset_type" });
  });

  it("requires a UUID asset_id", () => {
    expect(validateAssetAssessmentCreate({ asset_type: "endpoint" })).toEqual({
      error: "asset_id_required"
    });
    expect(
      validateAssetAssessmentCreate({ asset_type: "endpoint", asset_id: "not-a-uuid" })
    ).toEqual({ error: "asset_id_must_be_uuid" });
  });

  it("accepts every registry asset type (zero-new-code onboarding)", () => {
    for (const t of [
      "vendor", "ai_system", "application", "database", "cloud_resource",
      "endpoint", "api", "identity_system", "business_process", "generic"
    ]) {
      const r = validateAssetAssessmentCreate({ asset_type: t, asset_id: ASSET_ID });
      expect("input" in r, t).toBe(true);
    }
  });

  it("defaults status to not_started and validates explicit statuses", () => {
    const r = validateAssetAssessmentCreate({ ...BASE });
    if (!("input" in r)) throw new Error("expected input");
    expect(r.input.status).toBe("not_started");

    expect(validateAssetAssessmentCreate({ ...BASE, status: "bogus" })).toMatchObject({
      error: "invalid_status"
    });
    const ok = validateAssetAssessmentCreate({ ...BASE, status: "in_progress" });
    expect("input" in ok).toBe(true);
  });

  it("validates severity vocabulary and optional field types", () => {
    expect(
      validateAssetAssessmentCreate({ ...BASE, overall_severity: "SEVERE" })
    ).toMatchObject({ error: "invalid_overall_severity" });
    expect(validateAssetAssessmentCreate({ ...BASE, summary: 42 })).toEqual({
      error: "summary_must_be_string_or_null"
    });
    expect(validateAssetAssessmentCreate({ ...BASE, performed_at: "07/04/2026" })).toMatchObject({
      error: "performed_at_invalid_format"
    });
    expect(validateAssetAssessmentCreate({ ...BASE, reviewer_id: "nope" })).toEqual({
      error: "reviewer_id_must_be_uuid_or_null"
    });

    const full = validateAssetAssessmentCreate({
      ...BASE,
      status: "in_progress",
      overall_severity: "High",
      summary: "  s  ",
      notes: "n",
      performed_at: "2026-07-06",
      reviewer_id: ASSET_ID
    });
    if (!("input" in full)) throw new Error("expected input");
    expect(full.input).toMatchObject({
      asset_type: "endpoint",
      asset_id: ASSET_ID,
      status: "in_progress",
      overall_severity: "High",
      summary: "s",
      performed_at: "2026-07-06"
    });
  });
});

describe("validateAssetAssessmentStatusTransition", () => {
  it("requires a valid status", () => {
    expect(validateAssetAssessmentStatusTransition({})).toEqual({ error: "status_required" });
    expect(validateAssetAssessmentStatusTransition({ status: "bogus" })).toMatchObject({
      error: "invalid_status"
    });
  });

  it("requires severity when transitioning into a finding status", () => {
    for (const status of FINDING_STATUSES) {
      expect(validateAssetAssessmentStatusTransition({ status })).toMatchObject({
        error: "overall_severity_required"
      });
      const ok = validateAssetAssessmentStatusTransition({
        status,
        overall_severity: "Critical"
      });
      expect("input" in ok, status).toBe(true);
    }
    const noSev = validateAssetAssessmentStatusTransition({ status: "in_progress" });
    expect("input" in noSev).toBe(true);
  });
});

describe("status machine (spec-driven)", () => {
  it("mirrors the obligation-shaped lifecycle", () => {
    expect(isValidTransition("not_started", "in_progress")).toBe(true);
    expect(isValidTransition("not_started", "satisfactory")).toBe(false);
    expect(isValidTransition("in_progress", "satisfactory")).toBe(true);
    expect(isValidTransition("in_progress", "deficient")).toBe(true);
    expect(isValidTransition("in_progress", "remediation_required")).toBe(true);
    for (const terminal of TERMINAL_STATUSES) {
      expect(isValidTransition(terminal, "in_progress"), terminal).toBe(false);
    }
  });

  it("finding statuses are exactly deficient + remediation_required", () => {
    expect([...FINDING_STATUSES].sort()).toEqual(["deficient", "remediation_required"]);
  });
});
