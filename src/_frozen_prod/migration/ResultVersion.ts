/**
 * Canonical Result Versions
 * Locked registry
 */
export const RESULT_VERSIONS = {
  V1: "audit-sprint-result-v1"
} as const;

export type ResultVersion =
  typeof RESULT_VERSIONS[keyof typeof RESULT_VERSIONS];
