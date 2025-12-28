/**
 * Execution Context — V1
 *
 * Locks all variables that affect audit determinism.
 * ENTERPRISE EXECUTION CONTRACT
 */
export interface ExecutionContextV1 {
  engineVersion: string;
  productVersion: string;

  framework: {
    name: string;        // e.g. SOC2, ISO27001
    version: string;     // e.g. 2017, 2022
  };

  scoringModelVersion: string;
  severityModelVersion: string;

  executedAt: string;
}
