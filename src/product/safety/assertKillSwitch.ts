import type { KillSwitchV1 } from "./KillSwitchV1";

export function assertKillSwitch(sw: KillSwitchV1): void {
  if (sw.active) {
    throw new Error("SYSTEM_HALTED");
  }
}
