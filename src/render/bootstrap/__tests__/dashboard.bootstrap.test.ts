import { RendererRegistry } from "../../pipeline/RendererRegistry";
import "../registerAllRenderers";

describe("Dashboard renderer bootstrap", () => {
  it("registers DASHBOARD renderer", () => {
    expect(RendererRegistry.get("DASHBOARD")).toBeDefined();
  });
});
