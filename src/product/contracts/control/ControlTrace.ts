/**
 * Control Trace — V1
 *
 * Cryptographically traceable control execution record.
 * ENTERPRISE AUDIT CONTRACT
 */
export interface ControlTraceV1 {
  controlId: string;
  domain: string;

  evaluatedAt: string;

  score: number; // 0–100
  outcome: "Pass" | "Fail" | "Partial";

  findingIds: string[];
  evidenceIds: string[];
}
