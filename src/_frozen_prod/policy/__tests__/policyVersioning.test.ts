import { describe, it, expect } from "vitest";
import { verifyPolicy } from "../verifyPolicy";

describe("Policy versioning", () => {
  it("rejects unknown policy version", () => {
    const result = verifyPolicy(
      { version: "v2" as any, allowedCapabilities: ["read"] },
      ["read"]
    );
    expect(result.valid).toBe(false);
  });
});
