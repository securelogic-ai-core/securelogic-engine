import { HashChainStore } from "./artifacts/HashChainStore.js";
import type { EngineExecutionRecord } from "securelogic-contracts";

export const executionStore = new HashChainStore<EngineExecutionRecord>(
  "./execution-ledger"
);
