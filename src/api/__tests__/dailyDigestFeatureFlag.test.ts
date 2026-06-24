import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dailyDigestEnabled } from "../lib/dailyDigestFeatureFlag.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["SECURELOGIC_DAILY_DIGEST_ENABLED"];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("dailyDigestEnabled", () => {
  it("disabled by default when the flag is unset", () => {
    expect(dailyDigestEnabled()).toBe(false);
  });

  it("disabled in production when the flag is unset", () => {
    process.env["NODE_ENV"] = "production";
    expect(dailyDigestEnabled()).toBe(false);
  });

  it("enabled only when SECURELOGIC_DAILY_DIGEST_ENABLED=true", () => {
    process.env["SECURELOGIC_DAILY_DIGEST_ENABLED"] = "true";
    expect(dailyDigestEnabled()).toBe(true);
  });

  it("disabled for any value other than the exact string 'true'", () => {
    for (const v of ["1", "TRUE", "yes", "on", " true ", ""]) {
      process.env["SECURELOGIC_DAILY_DIGEST_ENABLED"] = v;
      expect(dailyDigestEnabled()).toBe(false);
    }
  });

  it("reads from an explicitly passed env object", () => {
    expect(
      dailyDigestEnabled({ SECURELOGIC_DAILY_DIGEST_ENABLED: "true" })
    ).toBe(true);
    expect(dailyDigestEnabled({})).toBe(false);
  });
});
