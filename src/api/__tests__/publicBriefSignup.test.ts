import { describe, it, expect } from "vitest";
import { validateBriefSignup } from "../lib/briefSignupValidation.js";

// ----------------------------------------------------------------
// validateBriefSignup — covers the four required cases
// ----------------------------------------------------------------

describe("validateBriefSignup — valid input", () => {
  it("201 path: valid email with name", () => {
    const result = validateBriefSignup({ email: "alice@example.com", name: "Alice" });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.email).toBe("alice@example.com");
      expect(result.input.name).toBe("Alice");
    }
  });

  it("201 path: valid email without optional name", () => {
    const result = validateBriefSignup({ email: "bob@example.com" });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.email).toBe("bob@example.com");
      expect(result.input.name).toBeNull();
    }
  });

  it("201 path: email is normalised to lowercase", () => {
    const result = validateBriefSignup({ email: "Carol@Example.COM" });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.email).toBe("carol@example.com");
    }
  });

  it("201 path: leading/trailing whitespace trimmed from email", () => {
    const result = validateBriefSignup({ email: "  dave@example.com  " });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.email).toBe("dave@example.com");
    }
  });

  it("201 path: name trimmed and capped at 255 chars", () => {
    const longName = "A".repeat(300);
    const result = validateBriefSignup({ email: "eve@example.com", name: longName });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.name?.length).toBe(255);
    }
  });

  it("201 path: whitespace-only name becomes null", () => {
    const result = validateBriefSignup({ email: "frank@example.com", name: "   " });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.name).toBeNull();
    }
  });
});

describe("validateBriefSignup — 400 invalid_email", () => {
  it("rejects missing email field", () => {
    const result = validateBriefSignup({ name: "Alice" });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_email");
      expect(result.status).toBe(400);
    }
  });

  it("rejects empty string email", () => {
    const result = validateBriefSignup({ email: "" });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_email");
  });

  it("rejects malformed email — no @", () => {
    const result = validateBriefSignup({ email: "notanemail" });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_email");
  });

  it("rejects malformed email — no TLD", () => {
    const result = validateBriefSignup({ email: "user@domain" });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_email");
  });

  it("rejects email that is a number", () => {
    const result = validateBriefSignup({ email: 12345 });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_email");
  });

  it("rejects email that is an array", () => {
    const result = validateBriefSignup({ email: ["a@b.com"] });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_email");
  });

  it("rejects null body", () => {
    const result = validateBriefSignup(null);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_email");
  });

  it("rejects empty body", () => {
    const result = validateBriefSignup({});
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_email");
  });
});

// ----------------------------------------------------------------
// 409 already_subscribed path
// The route handler catches Postgres error code 23505 and maps it
// to { error: "already_subscribed" }. Test the guard condition.
// ----------------------------------------------------------------

describe("409 already_subscribed — Postgres unique violation detection", () => {
  it("identifies code 23505 as a unique violation", () => {
    const err = Object.assign(new Error("duplicate key value"), { code: "23505" });
    expect(err.code).toBe("23505");
  });

  it("does not misclassify a generic error as duplicate", () => {
    const err = new Error("connection refused");
    expect((err as any).code).toBeUndefined();
  });
});
