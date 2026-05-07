/**
 * RR-6 — Validator unit tests for risk_obligation_links.
 *
 * Mirrors riskControlLinkValidation tests. The router-level validator
 * accepts only obligation_id + optional note (the URL carries risk_id).
 */

import { describe, it, expect } from "vitest";
import {
  validateRiskObligationLinkCreate,
  isUuid,
} from "../lib/riskObligationLinkValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("validateRiskObligationLinkCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskObligationLinkCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRiskObligationLinkCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateRiskObligationLinkCreate("obligation");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects undefined body", () => {
    const r = validateRiskObligationLinkCreate(undefined);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateRiskObligationLinkCreate — obligation_id", () => {
  it("rejects missing obligation_id", () => {
    const r = validateRiskObligationLinkCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects empty obligation_id", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects non-string obligation_id", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: 42 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects non-UUID obligation_id", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_must_be_uuid");
  });

  it("accepts a valid UUID obligation_id and trims it", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: `  ${VALID_UUID}  ` });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.obligation_id).toBe(VALID_UUID);
  });
});

describe("validateRiskObligationLinkCreate — note", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: VALID_UUID });
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts an explicit null", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: VALID_UUID, note: null });
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("normalizes whitespace-only note to null", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: VALID_UUID, note: "   " });
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts a short string note", () => {
    const r = validateRiskObligationLinkCreate({
      obligation_id: VALID_UUID,
      note: "Risk affects HIPAA §164.312(a)(1)",
    });
    if ("input" in r) expect(r.input.note).toBe("Risk affects HIPAA §164.312(a)(1)");
  });

  it("rejects non-string note", () => {
    const r = validateRiskObligationLinkCreate({ obligation_id: VALID_UUID, note: 123 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_must_be_string");
  });

  it("rejects note > 500 chars", () => {
    const r = validateRiskObligationLinkCreate({
      obligation_id: VALID_UUID,
      note: "x".repeat(501),
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_too_long");
  });

  it("accepts note exactly 500 chars", () => {
    const r = validateRiskObligationLinkCreate({
      obligation_id: VALID_UUID,
      note: "x".repeat(500),
    });
    expect("input" in r).toBe(true);
  });
});

describe("isUuid (re-exported)", () => {
  it("accepts canonical UUID v4", () => {
    expect(isUuid(VALID_UUID)).toBe(true);
  });

  it("rejects bad-shape strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
