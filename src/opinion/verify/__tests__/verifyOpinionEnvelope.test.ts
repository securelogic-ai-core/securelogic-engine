import { createOpinionEnvelopeV1 } from "../../envelope/createOpinionEnvelopeV1";
import { verifyOpinionEnvelope } from "../verifyOpinionEnvelope";

describe("Opinion envelope verification", () => {
  it("rejects unsigned opinion envelopes", () => {
    const env = createOpinionEnvelopeV1({
      kind: "SecureLogicOpinion",
      version: "v1",
      scope: "SOC_READINESS",
      verdict: "CONDITIONAL",
      issuedAt: new Date().toISOString(),
      evidence: [],
      signature: "" // intentionally unsigned
    });

    expect(verifyOpinionEnvelope(env).status).toBe("INVALID_SIGNATURE");
  });
});
