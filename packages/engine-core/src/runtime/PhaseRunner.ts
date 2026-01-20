import { hashObject } from "../utils/hasher.js";
import type { RiskContext, Decision } from "securelogic-contracts";
import type { ExecutionLedger } from "./ExecutionLedger.js";

export class PhaseRunner {
  async runAll(context: RiskContext, ledger: ExecutionLedger): Promise<Decision> {
    let current: unknown = context;

    const phases = [
      { name: "ingest", fn: (x: unknown) => x },
      { name: "score", fn: (x: unknown) => x },
      { name: "decide", fn: (x: unknown) => x }
    ];

    for (const phase of phases) {
      const inputHash = hashObject(current);
      const output = phase.fn(current);
      const outputHash = hashObject(output);

      ledger.recordPhase({
        name: phase.name,
        inputHash,
        outputHash,
        timestamp: new Date().toISOString()
      });

      current = output;
    }

    return current as Decision;
  }
}
