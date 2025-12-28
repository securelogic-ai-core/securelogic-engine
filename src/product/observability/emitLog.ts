import type { LogEventV1 } from "./LogEventV1";

export function emitLog(_: LogEventV1): void {
  // enterprise hook point (exporter injected at runtime)
}
