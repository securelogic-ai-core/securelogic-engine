import { mapOpinionToDashboard } from "../mapOpinionToDashboard";

describe("Dashboard opinion adapter", () => {
  it("maps envelope to dashboard summary", () => {
    const out = mapOpinionToDashboard({
      kind: "OpinionEnvelope",
      version: "v1",
      payload: {
        kind: "SecureLogicOpinion",
        version: "v1",
        scope: "THIRD_PARTY_RISK",
        verdict: "DEFICIENT",
        issuedAt: "now",
        evidence: [],
        signature: ""
      },
      payloadHash: "x",
      signatures: []
    });

    expect(out.verdict).toBe("DEFICIENT");
  });
});
