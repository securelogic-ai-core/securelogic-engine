import { executeRenderPipeline } from "../executeRenderPipeline";
import type { RenderManifestV1 } from "../../manifest/RenderManifestV1";

describe("PDF license enforcement", () => {
  it("blocks PDF rendering on CORE license when disallowed", () => {
    const manifest: RenderManifestV1 = {
      license: "CORE",
      target: "PDF",
      subject: { id: "org-1", type: "ORG" }
    };

    const result = executeRenderPipeline(manifest);

    expect(result.status).toBe("LICENSE_VIOLATION");
  });
});
