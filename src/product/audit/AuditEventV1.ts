export interface AuditEventV1 {
  version: "audit-event-v1";
  eventId: string;
  type:
    | "VERIFY_REQUEST"
    | "VERIFY_SUCCESS"
    | "VERIFY_FAILURE"
    | "REVOKE"
    | "KEY_ROTATION";
  envelopeId?: string;
  verifierId: string;
  requestId: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}
