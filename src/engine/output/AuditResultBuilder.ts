import type { Clock } from "../runtime/Clock.js";

export class AuditResultBuilder {
  static build(
    client: any,
    input: any,
    decision: any,
    ledgerHash: string,
    findings: any[],
    clock: Clock
  ) {
    return {
      client,
      decision,
      report: {
        industry: client.industry,
        generatedAt: clock.now(),
        ledgerHash,
        findings
      }
    };
  }
}
