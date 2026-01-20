import type { ExecutionRecord } from "securelogic-contracts";
import type { SignatureBundle } from "./crypto/signing.js";

export interface ExecutionEnvelope {
  record: ExecutionRecord;
  signature: SignatureBundle;
}
