import { HashChainStore } from "./artifacts/HashChainStore.js";
import type { EngineExecutionRecord } from "securelogic-contracts";
import type { ExecutionEnvelope } from "./ExecutionEnvelope.js";

import { signObject } from "./crypto/signing.js";
import { loadPrivateKey, loadPublicKey } from "./crypto/engineKeys.js";

export const executionStore = new HashChainStore<ExecutionEnvelope>(
  "./execution-ledger"
);

export function storeExecution(record: EngineExecutionRecord) {
  const privateKey = loadPrivateKey();
  const publicKey = loadPublicKey();

  const sig = signObject(record, privateKey);
  sig.publicKey = publicKey;

  const envelope: ExecutionEnvelope = {
    record,
    signature: sig
  };

  return executionStore.write(envelope);
}
