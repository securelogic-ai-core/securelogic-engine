import type { IncidentRecordV1 } from "./IncidentRecordV1";

export function assertIncidentHandled(ir: IncidentRecordV1): void {
  if (!ir.containedAt) {
    throw new Error("INCIDENT_NOT_CONTAINED");
  }
}
