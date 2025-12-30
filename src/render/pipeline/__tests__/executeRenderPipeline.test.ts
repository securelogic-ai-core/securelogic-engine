import { executeRenderPipeline } from "../executeRenderPipeline";
import type { RenderManifestV1 } from "../../manifest/RenderManifestV1";

describe("Render pipeline", () => {
  it("renders PDF manifests end-to-end", () => {
    const manifest: RenderManifestV1 = {
      license: "PRO",
      target: "PDF",
      subject: { id: "org-1", type: "ORG" }
    };

    const result = executeRenderPipeline(manifest);

    expect(result.status).toBe("RENDERED");

    if (result.status === "RENDERED") {
      expect(result.result.artifactType).toBe("PDF");
    }
  });
});
