import { describe, it, expect, afterEach } from "vitest";
import {
  legacyVendorWritesEnabled,
  engagementCta,
} from "@/lib/legacyVendorWrites";

/**
 * B1 demotion — the app-side flag must agree with the engine's
 * legacyVendorWriteFlag.ts semantics exactly: enabled unless the env var is
 * the literal "false". A divergence here means the UI offers writes the
 * engine 410s (or hides writes the engine still accepts).
 */

afterEach(() => {
  delete process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED;
});

describe("legacyVendorWritesEnabled", () => {
  it("is enabled by default (unset)", () => {
    delete process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED;
    expect(legacyVendorWritesEnabled()).toBe(true);
  });

  for (const v of ["true", "TRUE", "1", "", "no", "off", "False"]) {
    it(`is enabled for env=${JSON.stringify(v)} — only the literal "false" disables`, () => {
      process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED = v;
      expect(legacyVendorWritesEnabled()).toBe(true);
    });
  }

  it('is disabled only for the literal "false"', () => {
    process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED = "false";
    expect(legacyVendorWritesEnabled()).toBe(false);
  });
});

describe("engagementCta", () => {
  it("targets the intake page with the vendor preselected", () => {
    expect(engagementCta("abc-123")).toEqual({
      // Vendor Onboarding 2.0: the canonical way in is the vendor page.
      href: "/vendors/abc-123#relationships",
      label: "Classify and assess from the vendor page",
    });
  });

  it("URL-encodes the vendor id", () => {
    expect(engagementCta("a/b?c").href).toBe(
      "/vendors/a%2Fb%3Fc#relationships"
    );
  });

  it("omits the query without a vendor", () => {
    expect(engagementCta().href).toBe("/vendors");
  });
});
