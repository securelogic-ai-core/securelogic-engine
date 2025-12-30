import type { RenderResult } from "../pipeline/RenderResult";

export interface RenderReceiptV1 {
  kind: "SecureLogicRenderReceipt";
  version: "v1";
  manifestId: string;
  artifactHash: string;
  artifact: RenderResult;
  issuedAt: string;
}
