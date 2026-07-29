import { describe, it, expect } from "vitest";
import {
  validateOrgSettingsPatch,
  MAX_ORG_NAME_LENGTH,
  ORG_SCALES,
} from "../lib/orgSettingsValidation.js";

describe("validateOrgSettingsPatch — body shape", () => {
  it("rejects non-object bodies", () => {
    for (const body of [null, undefined, "x", 5, true, ["name"]]) {
      const r = validateOrgSettingsPatch(body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("invalid_body");
    }
  });

  it("rejects an empty patch — a no-op PATCH is a caller bug, not a success", () => {
    const r = validateOrgSettingsPatch({});
    expect(r).toMatchObject({ ok: false, error: "empty_patch" });
  });

  it("rejects unknown fields by name (typos must not silently no-op)", () => {
    const r = validateOrgSettingsPatch({ requore_mfa: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("unknown_field");
      expect(r.detail).toContain("requore_mfa");
    }
  });
});

describe("validateOrgSettingsPatch — name", () => {
  it("trims and accepts a valid name", () => {
    const r = validateOrgSettingsPatch({ name: "  Meridian Health  " });
    expect(r).toEqual({ ok: true, patch: { name: "Meridian Health" } });
  });

  it("rejects empty / whitespace-only / non-string names", () => {
    for (const name of ["", "   ", 42, null, true]) {
      const r = validateOrgSettingsPatch({ name });
      expect(r).toMatchObject({ ok: false, error: "invalid_name" });
    }
  });

  it("caps name length", () => {
    const ok = validateOrgSettingsPatch({ name: "x".repeat(MAX_ORG_NAME_LENGTH) });
    expect(ok.ok).toBe(true);
    const long = validateOrgSettingsPatch({ name: "x".repeat(MAX_ORG_NAME_LENGTH + 1) });
    expect(long).toMatchObject({ ok: false, error: "invalid_name" });
  });
});

describe("validateOrgSettingsPatch — booleans", () => {
  it("accepts each boolean field and preserves false", () => {
    const r = validateOrgSettingsPatch({
      require_mfa: false,
      regulated: true,
      handles_pii: false,
      safety_critical: true,
    });
    expect(r).toEqual({
      ok: true,
      patch: { require_mfa: false, regulated: true, handles_pii: false, safety_critical: true },
    });
  });

  it("rejects truthy non-booleans per field (preserves the legacy invalid_require_mfa code)", () => {
    for (const field of ["require_mfa", "regulated", "handles_pii", "safety_critical"]) {
      const r = validateOrgSettingsPatch({ [field]: "true" });
      expect(r).toMatchObject({ ok: false, error: `invalid_${field}` });
    }
  });
});

describe("validateOrgSettingsPatch — scale", () => {
  it("accepts exactly the engine's scale vocabulary", () => {
    for (const scale of ORG_SCALES) {
      expect(validateOrgSettingsPatch({ scale })).toEqual({ ok: true, patch: { scale } });
    }
  });

  it("rejects anything else, including case drift", () => {
    for (const scale of ["small", "ENTERPRISE", "Large", 3, null]) {
      expect(validateOrgSettingsPatch({ scale })).toMatchObject({ ok: false, error: "invalid_scale" });
    }
  });
});

describe("validateOrgSettingsPatch — partial updates", () => {
  it("any validated subset passes through unchanged", () => {
    const r = validateOrgSettingsPatch({ name: "Acme", scale: "Enterprise", handles_pii: true });
    expect(r).toEqual({
      ok: true,
      patch: { name: "Acme", scale: "Enterprise", handles_pii: true },
    });
  });
});
