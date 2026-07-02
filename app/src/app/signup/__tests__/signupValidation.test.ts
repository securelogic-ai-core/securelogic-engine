import { describe, it, expect } from "vitest";
import {
  validatePasswordStrength,
  validatePasswordsMatch,
} from "../signupValidation";

describe("validatePasswordStrength", () => {
  it("accepts a 12+ char password with upper, lower, and a digit", () => {
    expect(validatePasswordStrength("Abcdefgh1234")).toBeNull();
  });

  it("rejects a too-short password", () => {
    expect(validatePasswordStrength("Ab1cdef")).toMatch(/12\+ characters/);
  });

  it("rejects a password missing a character class", () => {
    expect(validatePasswordStrength("abcdefghijkl")).toMatch(/uppercase/);
    expect(validatePasswordStrength("ABCDEFGHIJKL")).toMatch(/lowercase/);
    expect(validatePasswordStrength("Abcdefghijkl")).toMatch(/number/);
  });
});

describe("validatePasswordsMatch (Confirm Password)", () => {
  it("returns null when password and confirmation are identical", () => {
    expect(validatePasswordsMatch("Abcdefgh1234", "Abcdefgh1234")).toBeNull();
  });

  it("flags a mismatch (the silent-typo / lockout case)", () => {
    expect(validatePasswordsMatch("Abcdefgh1234", "Abcdefgh1235")).toBe(
      "Passwords do not match.",
    );
  });

  it("flags an empty confirmation against a real password", () => {
    expect(validatePasswordsMatch("Abcdefgh1234", "")).toBe(
      "Passwords do not match.",
    );
  });

  it("is case- and whitespace-sensitive (exact match required)", () => {
    expect(validatePasswordsMatch("Abcdefgh1234", "abcdefgh1234")).not.toBeNull();
    expect(validatePasswordsMatch("Abcdefgh1234 ", "Abcdefgh1234")).not.toBeNull();
  });
});
