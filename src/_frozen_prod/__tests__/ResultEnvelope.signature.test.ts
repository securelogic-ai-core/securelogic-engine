import { describe, it, expect } from "vitest";

import { createResultEnvelopeV1 } from "../factories/ResultEnvelopeFactory";
import { signResultEnvelope } from "../signing/signResultEnvelope";

describe("ResultEnvelope signing", () => {
  it("attaches a signature", () => {
    const payload = { controls: [] } as any;
    const envelope = createResultEnvelopeV1(payload);
    const signed = signResultEnvelope(envelope);

    expect(signed.signatures?.length).toBe(1);
  });
});
