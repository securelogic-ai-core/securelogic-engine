import { describe, it, expect } from "vitest";
import { canonicalHash } from "../runtime/canonicalHash.js";

describe("canonicalHash", () => {
  it("produces identical hashes for different key order", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });
});
