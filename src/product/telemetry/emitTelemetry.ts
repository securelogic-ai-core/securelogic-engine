import crypto from "crypto";
import type { TelemetryEventV1 } from "./TelemetryEventV1";

export function emitTelemetry(
  category: TelemetryEventV1["category"],
  severity: TelemetryEventV1["severity"],
  message: string
): TelemetryEventV1 {
  return Object.freeze({
    version: "telemetry-event-v1",
    eventId: crypto.randomUUID(),
    category,
    severity,
    message,
    occurredAt: new Date().toISOString()
  });
}
