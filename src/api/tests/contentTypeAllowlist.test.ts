import { describe, it, expect } from "vitest";
import { isContentTypeEnforcementExempt } from "../lib/contentTypeAllowlist.js";

describe("isContentTypeEnforcementExempt", () => {
  it("exempts the Ask voice transcription upload (regression: this was the 415 bug)", () => {
    expect(isContentTypeEnforcementExempt("/api/ask/transcribe")).toBe(true);
    expect(isContentTypeEnforcementExempt("/api/ask/transcribe?x=1")).toBe(true);
  });

  it("exempts the other legitimate non-JSON routes", () => {
    expect(isContentTypeEnforcementExempt("/webhooks/lemon")).toBe(true);
    expect(isContentTypeEnforcementExempt("/webhooks/email/resend")).toBe(true);
    expect(
      isContentTypeEnforcementExempt("/api/vendor-assessments/analyze-document")
    ).toBe(true);
    expect(isContentTypeEnforcementExempt("/api/vendor-assurance/documents")).toBe(true);
    expect(isContentTypeEnforcementExempt("/api/vendor-assurance/documents?page=1")).toBe(true);
    expect(isContentTypeEnforcementExempt("/api/sso/acme/acs")).toBe(true);
  });

  it("does NOT exempt the JSON Ask query endpoint (still must send application/json)", () => {
    expect(isContentTypeEnforcementExempt("/api/ask")).toBe(false);
  });

  it("does NOT exempt unrelated JSON routes", () => {
    expect(isContentTypeEnforcementExempt("/api/vendors")).toBe(false);
    expect(isContentTypeEnforcementExempt("/api/risks")).toBe(false);
    expect(isContentTypeEnforcementExempt("/api/transcribe")).toBe(false); // app-proxy path, not the engine route
  });

  it("is not fooled by the transcribe substring appearing elsewhere", () => {
    // Only the real prefix is exempt; an attacker can't smuggle JSON enforcement
    // off by embedding the string mid-path.
    expect(isContentTypeEnforcementExempt("/api/evil/api/ask/transcribe")).toBe(false);
  });
});
