import { ControlState } from "../contracts/ControlState";

/**
 * Scores control implementation completeness.
 * Deterministic, auditable, enterprise-safe.
 */
export function scoreControlState(controlState: ControlState): number {
  const sections = Object.values(controlState) as Record<string, boolean>[];

  let total = 0;
  let implemented = 0;

  for (const section of sections) {
    for (const value of Object.values(section)) {
      total += 1;
      if (value === true) implemented += 1;
    }
  }

  if (total === 0) return 0;
  return Math.round((implemented / total) * 100);
}
