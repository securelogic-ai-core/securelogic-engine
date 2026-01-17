import { canonicalHash } from "./canonicalHash.js";
import type { ExecutionRecord } from "./ExecutionRecord.js";
import type { ExecutionRecord } from "./ExecutionRecord.js";
import { hashCanonical } from "../crypto/Hash.js";
import { signPayload } from "../crypto/Signature.js";
import { KeyStore } from "../crypto/KeyStore.js";
import { executionStore, getLastExecutionHash } from "./ExecutionStore.js";

import { ENGINE_VERSION, ENGINE_VERSION_HASH } from "../version.js";

import type { RiskContext, RiskDecision, EngineExecutionRecord } from "securelogic-contracts";

export class ExecutionLedger {
  private phases: any[] = [];
  private contextHash!: string;
  private policyBundleHash!: string;
  private finalDecision!: RiskDecision;

  begin(context: RiskContext) {
    this.contextHash = hashCanonical(context);
  }

  setPolicyBundle(bundle: { hash: string }) {
    this.policyBundleHash = bundle.hash;
  }

  recordPhase(phase: { name: string; inputHash: string; outputHash: string; timestamp: string }) {
    this.phases.push(phase);
  }

  finalize(decision: RiskDecision) {
    this.finalDecision = decision;
  }

  build(): EngineExecutionRecord {
    return {
      engineVersion: ENGINE_VERSION,
      engineVersionHash: ENGINE_VERSION_HASH,
      policyBundleHash: this.policyBundleHash,
      inputHash: this.contextHash,
      phases: this.phases,
      finalDecision: this.finalDecision,
      finalDecisionHash: hashCanonical(this.finalDecision)
    };
  }

  seal(): ExecutionRecord {
    const payload = this.build();
    const payloadHash = hashCanonical(payload);

    const previousHash = getLastExecutionHash();

    const keys = KeyStore.generate();

    const signature = signPayload(payloadHash, keys.privateKey);

    const envelope: ExecutionEnvelope = {
      payload,
      payloadHash,
      previousHash,
      signature,
      publicKey: keys.publicKey
    };

    executionStore.append(envelope);

    return envelope;
  }
}
