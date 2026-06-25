import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { legacyNewsletterEnabled } from "../lib/legacyNewsletterFeatureFlag.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["SECURELOGIC_LEGACY_NEWSLETTER_ENABLED"];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("legacyNewsletterEnabled", () => {
  it("disabled by default when the flag is unset", () => {
    expect(legacyNewsletterEnabled()).toBe(false);
  });

  it("disabled in production when the flag is unset", () => {
    process.env["NODE_ENV"] = "production";
    expect(legacyNewsletterEnabled()).toBe(false);
  });

  it("enabled only when SECURELOGIC_LEGACY_NEWSLETTER_ENABLED=true", () => {
    process.env["SECURELOGIC_LEGACY_NEWSLETTER_ENABLED"] = "true";
    expect(legacyNewsletterEnabled()).toBe(true);
  });

  it("disabled when the flag is set to anything other than the exact string 'true'", () => {
    for (const v of ["1", "TRUE", "yes", "on", " true ", ""]) {
      process.env["SECURELOGIC_LEGACY_NEWSLETTER_ENABLED"] = v;
      expect(legacyNewsletterEnabled()).toBe(false);
    }
  });

  it("reads from an explicitly passed env object", () => {
    expect(
      legacyNewsletterEnabled({ SECURELOGIC_LEGACY_NEWSLETTER_ENABLED: "true" })
    ).toBe(true);
    expect(legacyNewsletterEnabled({})).toBe(false);
  });
});
