import type { ShutdownSignalV1 } from "./ShutdownSignalV1";

export function handleShutdown(_: ShutdownSignalV1): void {
  process.exit(1);
}
