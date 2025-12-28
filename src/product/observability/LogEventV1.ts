export interface LogEventV1 {
  level: "INFO" | "WARN" | "ERROR" | "SECURITY";
  code: string;
  message: string;
  occurredAt: string;
  correlationId?: string;
}
