import { describe, it, expect } from "vitest";

import { describe, it, expect } from "vitest";
import { createResultEnvelopeV1 } from "../factories/ResultEnvelopeFactory";
import { verifyResultEnvelope } from "../integrity/verifyResultEnvelope";

describe("ResultEnvelopeV1 integrity", () => {
  it("detects tampering", () => {
    const payload: any = {
      kind: "audit-sprint-result",
      version: "audit-sprint-result-v1"
    };

    const envelope = createResultEnvelopeV1(payload);
    expect(verifyResultEnvelope(envelope)).toBe(true);

    (payload as any).version = "tampered";
    expect(verifyResultEnvelope(envelope)).toBe(false);
  });
});
