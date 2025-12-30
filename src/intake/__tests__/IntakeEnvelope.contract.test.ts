import { describe, it, expect } from "vitest";
import type { IntakeEnvelopeV1 } from "../IntakeEnvelopeV1";

describe("IntakeEnvelopeV1 contract", () => {
  it("is structurally valid", () => {
    const env: IntakeEnvelopeV1 = {
      version: "V1",
      runContext: {
        runId: "run-1",
        createdAt: new Date().toISOString(),
        source: "WEB"
      },
      organization: {
        organizationId: "org-1"
      },
      license: {
        tier: "CORE"
      },
      answers: [],
      evidence: [],
      integrity: {
        checksumSha256: "abc"
      }
    };

    expect(env.version).toBe("V1");
  });
});
