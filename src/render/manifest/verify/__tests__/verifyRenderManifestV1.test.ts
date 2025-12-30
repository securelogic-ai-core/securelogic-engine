import { generateRenderManifestV1 } from "../generate/generateRenderManifestV1";
import { verifyRenderManifestV1 } from "../verifyRenderManifestV1";

describe("RenderManifestV1 verification", () => {
  it("fails unsigned manifests", () => {
    const manifest = generateRenderManifestV1({
      source: { type: "AUDIT_RESULT", referenceId: "audit-123" },
      targets: ["PDF"],
      requestedBy: "SYSTEM",
    });

    expect(verifyRenderManifestV1(manifest).status).toBe("INVALID_SIGNATURE");
  });
});
