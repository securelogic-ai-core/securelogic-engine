import { describe, it, expect } from "vitest";
import { createResultEnvelopeV1 } from "../../product/envelope/createResultEnvelopeV1";
import { verifyResultEnvelopeWithPolicy } from "../../integrity/verifyResultEnvelopeWithPolicy";

describe("Policy + Envelope integration", () => {
  it("blocks capability outside policy", () => {
    const envelope = createResultEnvelopeV1(
      { data: "test" },
      {
        licenseTier: "CORE",
        allowedCapabilities: ["read"],
        issuedForTenant: "tenant-a"
      }
    );

    const result = verifyResultEnvelopeWithPolicy(envelope, ["write"]);
    expect(result.status).toBe("INVALID_POLICY");
  });

  it("allows capability within policy", () => {
    const envelope = createResultEnvelopeV1(
      { data: "test" },
      {
        licenseTier: "PRO",
        allowedCapabilities: ["read", "write"],
        issuedForTenant: "tenant-a"
      }
    );

    const result = verifyResultEnvelopeWithPolicy(envelope, ["write"]);
    expect(result.status).toBe("VALID");
  });
});
