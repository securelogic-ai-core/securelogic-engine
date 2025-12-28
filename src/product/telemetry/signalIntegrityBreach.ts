import { emitTelemetry } from "./emitTelemetry";

export function signalIntegrityBreach(reason: string): void {
  emitTelemetry(
    "INTEGRITY",
    "CRITICAL",
    `INTEGRITY_BREACH:${reason}`
  );
}
