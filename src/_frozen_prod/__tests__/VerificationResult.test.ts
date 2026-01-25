import { describe, it, expect } from "vitest";

import { describe, it, expect } from "vitest";
import { createResultEnvelopeV1 } from "../factories/ResultEnvelopeFactory";
import { verifyResultEnvelopeWithResult } from "../integrity/verifyResultEnvelopeWithResult";

describe("VerificationResult adapter", () => {
  it("returns VALID for untampered envelope", () => {
    const envelope = createResultEnvelopeV1({ version: "v1" });
    const result = verifyResultEnvelopeWithResult(envelope);
    expect(result.status).toBe("VALID");
  });
});
