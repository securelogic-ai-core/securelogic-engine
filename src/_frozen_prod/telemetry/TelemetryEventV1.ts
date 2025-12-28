export interface TelemetryEventV1 {
  version: "telemetry-event-v1";
  eventId: string;
  category: "SECURITY" | "PERFORMANCE" | "INTEGRITY" | "OPERATIONS";
  message: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  occurredAt: string;
}
