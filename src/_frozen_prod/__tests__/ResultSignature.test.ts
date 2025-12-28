import { describe, expect, it } from "vitest";
import { createResultEnvelopeV1 } from "../factories/ResultEnvelopeFactory";
import { signResultEnvelope } from "../signing/signResultEnvelope";
import { verifyResultEnvelope } from "../integrity/verifyResultEnvelope";

describe("ResultEnvelope signature integrity", () => {
  it("accepts a properly signed envelope", () => {
    const envelope = createResultEnvelopeV1({ version: "v1" });
    const signed = signResultEnvelope(envelope);

    expect(signed.signatures?.length).toBe(1);
    expect(verifyResultEnvelope(signed)).toBe(true);
  });

  it("rejects tampered signatures", () => {
    const envelope = createResultEnvelopeV1({ version: "v1" });
    const signed = signResultEnvelope(envelope);

    const tampered = structuredClone(signed);
    (tampered.signatures![0] as any).algorithm = "md5";

    expect(verifyResultEnvelope(tampered)).toBe(false);
  });
});
