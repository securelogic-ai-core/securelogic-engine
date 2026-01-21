import type { LedgerEntry } from "./ExecutionLedger.js";
import { RunnerEngine } from "../../engine/RunnerEngine.js";
import crypto from "node:crypto";

export class ReplayEngine {
  static hash(data: unknown): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  static async replayAndVerify(chain: LedgerEntry[]): Promise<boolean> {
    const engine = new RunnerEngine();

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];

      // Re-run engine with original input
      const result = await engine.run(entry.inputPayload as any);

      // Only hash the deterministic decision
      const recomputedOutputHash = this.hash((result as any).decision);

      if (recomputedOutputHash !== entry.outputHash) {
        console.error("❌ Output hash mismatch at entry", i);
        return false;
      }
    }

    return true;
  }
}
