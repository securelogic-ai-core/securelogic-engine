import type { ExecutionContextV1 } from "../contracts/context/ExecutionContext";

/**
 * Builds a locked execution context for deterministic replay.
 */
export function buildExecutionContext(): ExecutionContextV1 {
  return {
    engineVersion: "engine-v1",
    productVersion: "product-v1",

    framework: {
      name: "SOC2",
      version: "2017"
    },

    scoringModelVersion: "scoring-v1",
    severityModelVersion: "severity-v1",

    executedAt: new Date().toISOString()
  };
}
