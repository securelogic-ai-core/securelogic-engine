import type { RenderTarget } from "../contracts/RenderTarget";
import type { Renderer } from "./Renderer";
import { RENDERER_REGISTRY } from "./registerAll";

export class RendererRegistry {
  static get(target: RenderTarget): Renderer {
    return RENDERER_REGISTRY[target];
  }
}
