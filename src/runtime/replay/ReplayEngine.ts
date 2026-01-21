import crypto from "node:crypto";
import { DeterministicSerializer } from "../determinism/DeterministicSerializer.js";
import type { LedgerEntry } from "../ledger/ExecutionLedger.js";

export class ReplayEngine {
  static hash(data: unknown): string {
    return crypto
      .createHash("sha256")
      .update(DeterministicSerializer.stableStringify(data))
      .digest("hex");
  }

  static verifyReproduction(
    entry: LedgerEntry,
    input: unknown,
    output: unknown
  ): boolean {
    const inputHash = this.hash(input);
    const outputHash = this.hash(output);

    return (
      inputHash === entry.inputHash &&
      outputHash === entry.outputHash
    );
  }
}
