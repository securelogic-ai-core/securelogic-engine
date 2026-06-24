import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { matcherAlertsEnabled } from "../lib/alerting/matcherAlertsFeatureFlag.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["SECURELOGIC_MATCHER_ALERTS_ENABLED"];
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("matcherAlertsEnabled", () => {
  it("disabled by default when unset", () => {
    expect(matcherAlertsEnabled()).toBe(false);
  });
  it("disabled in production when unset", () => {
    process.env["NODE_ENV"] = "production";
    expect(matcherAlertsEnabled()).toBe(false);
  });
  it("enabled only on the exact string 'true'", () => {
    process.env["SECURELOGIC_MATCHER_ALERTS_ENABLED"] = "true";
    expect(matcherAlertsEnabled()).toBe(true);
  });
  it("disabled for any other value", () => {
    for (const v of ["1", "TRUE", "yes", " true ", ""]) {
      process.env["SECURELOGIC_MATCHER_ALERTS_ENABLED"] = v;
      expect(matcherAlertsEnabled()).toBe(false);
    }
  });
  it("reads an explicit env object", () => {
    expect(matcherAlertsEnabled({ SECURELOGIC_MATCHER_ALERTS_ENABLED: "true" })).toBe(true);
    expect(matcherAlertsEnabled({})).toBe(false);
  });
});
