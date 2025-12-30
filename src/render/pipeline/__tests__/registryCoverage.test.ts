import "../../bootstrap/registerAllRenderers";
import { RendererRegistry } from "../RendererRegistry";
import { RENDER_TARGETS } from "../../contracts/RenderTarget";

describe("Renderer registry coverage", () => {
  it("has a renderer for every declared RenderTarget", () => {
    for (const target of RENDER_TARGETS) {
      expect(RendererRegistry.get(target)).toBeDefined();
    }
  });
});
