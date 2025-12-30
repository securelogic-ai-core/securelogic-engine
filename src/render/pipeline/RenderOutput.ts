import type { RenderTarget } from "../manifest/RenderTarget";

export interface RenderOutput {
  target: RenderTarget;
  artifactId: string;
  location: string;
  hash: string;
}
