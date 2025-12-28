export interface IncidentRecordV1 {
  incidentId: string;
  tenantId: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detectedAt: string;
  containedAt?: string;
}
