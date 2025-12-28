/**
 * Canonical severity weights
 * Locked for deterministic scoring
 */
export const SEVERITY_WEIGHTS = {
  Low: 10,
  Medium: 30,
  High: 60,
  Critical: 90
} as const;
