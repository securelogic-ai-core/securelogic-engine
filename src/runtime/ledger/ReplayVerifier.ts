import { ExecutionLedger } from "./ExecutionLedger.js";
import { RunnerEngine } from "../../engine/RunnerEngine.js";
import crypto from "node:crypto";

export class ReplayVerifier {
  static hash(data: unknown): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  static async verifyAll(): Promise<boolean> {
    const ledger = new ExecutionLedger();

    // 1. Verify cryptographic chain first
    if (!ledger.verify()) {
      throw new Error("Ledger cryptographic verification failed");
    }

    const chain = ledger.getChain();
    const engine = new RunnerEngine();

    // 2. Replay every entry
    for (const entry of chain) {
      // We can't reconstruct original object, but we CAN verify output determinism
      // In Step 6 we will store full inputs; for now we assert chain integrity only
      if (!entry.outputHash || !entry.inputHash) {
        throw new Error("Ledger entry missing hashes");
      }
    }

    return true;
  }
}
