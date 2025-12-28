import type { KillSwitchV1 } from "./KillSwitchV1";

export function assertKillSwitch(k: KillSwitchV1): void {
  if (k.activated) {
    throw new Error("GLOBAL_KILL_SWITCH_ACTIVE");
  }
}
