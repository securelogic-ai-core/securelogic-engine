import { describe, it, expect } from "vitest";

import { describe, it, expect } from "vitest";
import { createResultEnvelopeV1 } from "../factories/ResultEnvelopeFactory";
import { verifyResultEnvelopeWithResult } from "../integrity/verifyResultEnvelopeWithResult";

describe("ResultEnvelope replay protection", () => {
  it("rejects replayed envelope", () => {
    const env = createResultEnvelopeV1({ version: "v1" } as any);

    expect(verifyResultEnvelopeWithResult(env).status).toBe("VALID");
    expect(verifyResultEnvelopeWithResult(env).status).toBe("INVALID_REPLAY");
  });
});
