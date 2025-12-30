import type { RenderTarget } from "../contracts/RenderTarget";

export interface RenderManifestV1 {
  version: "V1";
  target: RenderTarget;
  license: "CORE" | "PRO";
  payloadRef: string;
}
