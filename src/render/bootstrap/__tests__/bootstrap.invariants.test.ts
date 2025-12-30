import "../registerAllRenderers";
import { RendererRegistry } from "../../pipeline/RendererRegistry";

describe("Render bootstrap invariants", () => {
  it("registers PDF renderer", () => {
    expect(RendererRegistry.get("PDF")).toBeDefined();
  });

  it("registers DASHBOARD renderer", () => {
    expect(RendererRegistry.get("DASHBOARD")).toBeDefined();
  });
});
