import type { RenderManifestV1 } from "../RenderManifestV1";

describe("RenderManifestV1 contract", () => {
  it("exposes all required fields", () => {
    const shape: Record<keyof RenderManifestV1, true> = {
      kind: true,
      version: true,
      issuedAt: true,
      source: true,
      targets: true,
      inputs: true,
      requestedBy: true,
      integrity: true,
    };

    expect(shape).toBeDefined();
  });
});
