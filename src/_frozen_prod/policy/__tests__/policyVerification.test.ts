import { describe, it, expect } from "vitest";
import { verifyPolicy } from "../verifyPolicy";

describe("Policy enforcement", () => {
  it("rejects disallowed capability", () => {
    const result = verifyPolicy(
      {
        licenseTier: "CORE",
        allowedCapabilities: ["read"],
        issuedForTenant: "tenant-a"
      },
      ["write"]
    );

    expect(result.valid).toBe(false);
  });
});
