import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  riskLifecycleEnabled,
  riskLifecycleFeatureFlag,
} from "../lib/riskLifecycleFeatureFlag.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"];
  delete process.env["NODE_ENV"];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("riskLifecycleEnabled", () => {
  it("disabled by default when the flag is unset", () => {
    expect(riskLifecycleEnabled()).toBe(false);
  });

  it("disabled in NON-production too when unset (no NODE_ENV escape hatch)", () => {
    process.env["NODE_ENV"] = "test";
    expect(riskLifecycleEnabled()).toBe(false);
    process.env["NODE_ENV"] = "development";
    expect(riskLifecycleEnabled()).toBe(false);
  });

  it("disabled in production when unset", () => {
    process.env["NODE_ENV"] = "production";
    expect(riskLifecycleEnabled()).toBe(false);
  });

  it("enabled only when SECURELOGIC_RISK_LIFECYCLE_ENABLED=true", () => {
    process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] = "true";
    expect(riskLifecycleEnabled()).toBe(true);
  });

  it("disabled for any value other than the exact string 'true'", () => {
    for (const v of ["1", "TRUE", "yes", "on", " true ", ""]) {
      process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] = v;
      expect(riskLifecycleEnabled()).toBe(false);
    }
  });

  it("reads from an explicitly passed env object", () => {
    expect(
      riskLifecycleEnabled({ SECURELOGIC_RISK_LIFECYCLE_ENABLED: "true" })
    ).toBe(true);
    expect(riskLifecycleEnabled({})).toBe(false);
  });
});

describe("riskLifecycleFeatureFlag middleware", () => {
  it("calls next() when enabled", () => {
    process.env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] = "true";
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status };
    riskLifecycleFeatureFlag({} as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("returns a bare 404 with no surface details when disabled", () => {
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status };
    riskLifecycleFeatureFlag({} as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "not_found" });
  });
});
