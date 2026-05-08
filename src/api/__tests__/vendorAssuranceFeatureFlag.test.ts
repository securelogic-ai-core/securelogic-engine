import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vendorAssuranceEnabled, vendorAssuranceFeatureFlag } from "../lib/vendorAssuranceFeatureFlag.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"];
  delete process.env["NODE_ENV"];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("vendorAssuranceEnabled", () => {
  it("enabled when SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true", () => {
    process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
    process.env["NODE_ENV"] = "production";
    expect(vendorAssuranceEnabled()).toBe(true);
  });

  it("disabled in production when flag is unset", () => {
    process.env["NODE_ENV"] = "production";
    expect(vendorAssuranceEnabled()).toBe(false);
  });

  it("disabled in production when flag is set to anything other than 'true'", () => {
    process.env["NODE_ENV"] = "production";
    process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "1";
    expect(vendorAssuranceEnabled()).toBe(false);
  });

  it("enabled in non-production when flag unset (dev/test default)", () => {
    process.env["NODE_ENV"] = "test";
    expect(vendorAssuranceEnabled()).toBe(true);
  });
});

describe("vendorAssuranceFeatureFlag middleware", () => {
  it("calls next() when enabled", () => {
    process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
    const next = vi.fn();
    const status = vi.fn();
    const json = vi.fn();
    const res = { status: status.mockReturnValue({ json }) };
    vendorAssuranceFeatureFlag({} as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("returns 404 with no body details when disabled", () => {
    process.env["NODE_ENV"] = "production";
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status };
    vendorAssuranceFeatureFlag({} as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "not_found" });
  });
});
