import { executeRenderPipeline } from "../executeRenderPipeline";
import type { RenderManifestV1 } from "../../manifest/RenderManifestV1";

describe("Dashboard license enforcement", () => {
  it("blocks DASHBOARD on CORE license", () => {
    const manifest: RenderManifestV1 = {
      license: "CORE",
      target: "DASHBOARD",
      subject: { id: "org-1", type: "ORG" }
    };

    const result = executeRenderPipeline(manifest);
    expect(result.status).toBe("LICENSE_VIOLATION");
  });

  it("allows DASHBOARD on PRO license", () => {
    const manifest: RenderManifestV1 = {
      license: "PRO",
      target: "DASHBOARD",
      subject: { id: "org-1", type: "ORG" }
    };

    const result = executeRenderPipeline(manifest);
    expect(result.status).toBe("RENDERED");
  });
});
