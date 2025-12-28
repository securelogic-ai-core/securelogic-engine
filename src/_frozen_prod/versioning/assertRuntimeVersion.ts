import { RUNTIME_VERSION } from "./RuntimeVersion";

export function assertRuntimeVersion(expected: string): void {
  if (expected !== RUNTIME_VERSION) {
    throw new Error(
      `Runtime version mismatch: expected ${expected}, got ${RUNTIME_VERSION}`
    );
  }
}
