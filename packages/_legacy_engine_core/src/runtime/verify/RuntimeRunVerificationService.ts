import type { ExecutionRun } from "../run/ExecutionRun.js";
import type { RunReceipt } from "../receipt/RunReceipt.js";
import type { TransparencyEntry } from "../transparency/TransparencyChain.js";
import type { TrustStore } from "../trust/TrustStore.js";
import { hashRun } from "../run/RunHasher.js";
import { verifySignatureBytes } from "../ExecutionCrypto.js";

export type RunVerificationResult = {
  ok: boolean;
  error?: string;
};

export class RuntimeRunVerificationService {
  static async verify(
    trustStore: TrustStore,
    run: ExecutionRun,
    receipt: RunReceipt,
    transparency: TransparencyEntry
  ): Promise<RunVerificationResult> {

    const computedRunHash = hashRun(run);

    if (computedRunHash !== receipt.runHash) {
      return { ok: false, error: "Run hash mismatch" };
    }

    if (receipt.transparencyRoot !== transparency.root) {
      return { ok: false, error: "Transparency root mismatch" };
    }

    const trustedKey = await trustStore.getKey(receipt.signedBy);
    if (!trustedKey || trustedKey.status !== "active") {
      return { ok: false, error: "Signing key is not trusted" };
    }

    const sigOk = verifySignatureBytes(
      receipt.runHash,
      receipt.signature,
      trustedKey.publicKey
    );

    if (!sigOk) {
      return { ok: false, error: "Invalid signature" };
    }

    return { ok: true };
  }
}
    