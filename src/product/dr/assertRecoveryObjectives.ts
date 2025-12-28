import type { RecoveryObjectivesV1 } from "./RecoveryObjectivesV1";

export function assertRecoveryObjectives(
  obj: RecoveryObjectivesV1,
  actualRpo: number,
  actualRto: number
): void {
  if (actualRpo > obj.rpoMinutes || actualRto > obj.rtoMinutes) {
    throw new Error("RECOVERY_OBJECTIVES_VIOLATED");
  }
}
