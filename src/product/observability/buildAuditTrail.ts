import { drainAuditEvents } from "./auditEmitter";
import type { AuditTrailV1 } from "../contracts/_frozen/audit/AuditTrailV1";

export function buildAuditTrail(): AuditTrailV1 {
  return {
    version: "audit-trail-v1",
    events: drainAuditEvents()
  };
}
