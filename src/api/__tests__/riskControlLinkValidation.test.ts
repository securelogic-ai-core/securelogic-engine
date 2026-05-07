/**
 * RR-4 — Validator unit tests for risk_control_links.
 *
 * Mirrors signalControlLinkValidation tests. The router-level validator
 * accepts only control_id + optional note (the URL carries risk_id).
 */

import { describe, it, expect } from "vitest";
import {
  validateRiskControlLinkCreate,
  isUuid,
} from "../lib/riskControlLinkValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("validateRiskControlLinkCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskControlLinkCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRiskControlLinkCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateRiskControlLinkCreate("control");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects undefined body", () => {
    const r = validateRiskControlLinkCreate(undefined);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateRiskControlLinkCreate — control_id", () => {
  it("rejects missing control_id", () => {
    const r = validateRiskControlLinkCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects empty control_id", () => {
    const r = validateRiskControlLinkCreate({ control_id: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects non-string control_id", () => {
    const r = validateRiskControlLinkCreate({ control_id: 42 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects non-UUID control_id", () => {
    const r = validateRiskControlLinkCreate({ control_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_must_be_uuid");
  });

  it("accepts a valid UUID control_id and trims it", () => {
    const r = validateRiskControlLinkCreate({ control_id: `  ${VALID_UUID}  ` });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.control_id).toBe(VALID_UUID);
  });
});

describe("validateRiskControlLinkCreate — note", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskControlLinkCreate({ control_id: VALID_UUID });
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts an explicit null", () => {
    const r = validateRiskControlLinkCreate({ control_id: VALID_UUID, note: null });
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("normalizes whitespace-only note to null", () => {
    const r = validateRiskControlLinkCreate({ control_id: VALID_UUID, note: "   " });
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts a short string note", () => {
    const r = validateRiskControlLinkCreate({
      control_id: VALID_UUID,
      note: "Compensates for residual risk",
    });
    if ("input" in r) expect(r.input.note).toBe("Compensates for residual risk");
  });

  it("rejects non-string note", () => {
    const r = validateRiskControlLinkCreate({ control_id: VALID_UUID, note: 123 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_must_be_string");
  });

  it("rejects note > 500 chars", () => {
    const r = validateRiskControlLinkCreate({
      control_id: VALID_UUID,
      note: "x".repeat(501),
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_too_long");
  });

  it("accepts note exactly 500 chars", () => {
    const r = validateRiskControlLinkCreate({
      control_id: VALID_UUID,
      note: "x".repeat(500),
    });
    expect("input" in r).toBe(true);
  });
});

describe("isUuid", () => {
  it("accepts canonical UUID v4", () => {
    expect(isUuid(VALID_UUID)).toBe(true);
  });

  it("accepts uppercase UUIDs", () => {
    expect(isUuid(VALID_UUID.toUpperCase())).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("rejects bad-shape strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("a1b2c3d4-e5f6-7890-abcd")).toBe(false);
  });
});
