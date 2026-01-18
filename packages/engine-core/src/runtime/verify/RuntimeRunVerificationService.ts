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
    // 1. Verify run hash
    const computedRunHash = hashRun(run);
    if (computedRunHash !== receipt.runHash) {
      return { ok: false, error: "Run hash mismatch" };
    }

    // 2. Verify transparency root
    if (receipt.transparencyRoot !== transparency.root) {
      return { ok: false, error: "Transparency root mismatch" };
    }

    // 3. Verify signer is trusted
    const trustedKey = await trustStore.getKey(receipt.signedBy);
    if (!trustedKey || trustedKey.status !== "active") {
      return { ok: false, error: "Signing key is not trusted" };
    }

    // 4. Verify signature
    const sigOk = verifySignatureBytes(
      receipt.signedPayload,
      receipt.signature,
      trustedKey.publicKey
    );

    if (!sigOk) {
      return { ok: false, error: "Invalid signature" };
    }

    return { ok: true };
  }
}
