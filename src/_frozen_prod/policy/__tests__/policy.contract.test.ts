import { describe, it, expect } from "vitest";
import { verifyPolicy } from "../verifyPolicy";

describe("Policy contract", () => {
  it("always returns allowed and valid flags", () => {
    const result = verifyPolicy(
      { allowedCapabilities: ["read"] } as any,
      ["read"]
    );

    expect(typeof result.allowed).toBe("boolean");
    expect(typeof result.valid).toBe("boolean");
  });
});
