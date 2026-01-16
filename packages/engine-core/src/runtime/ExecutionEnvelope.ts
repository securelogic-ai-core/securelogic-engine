import type { EngineExecutionRecord } from "securelogic-contracts";
import type { SignatureBundle } from "./crypto/signing.js";

export interface ExecutionEnvelope {
  record: EngineExecutionRecord;
  signature: SignatureBundle;
}
