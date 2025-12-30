import type { RenderTarget } from "../contracts/RenderTarget";
import type { Renderer } from "./Renderer";

export type RendererMap = {
  [K in RenderTarget]: Renderer;
};
