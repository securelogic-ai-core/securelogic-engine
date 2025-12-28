import { CONFIG_LOCKED } from "./ConfigLock";

export function assertConfigLocked(): void {
  if (!CONFIG_LOCKED) {
    throw new Error("CONFIG_MUTATION_BLOCKED");
  }
}
