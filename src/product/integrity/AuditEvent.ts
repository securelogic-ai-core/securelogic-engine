export interface AuditEvent {
  eventId: string;
  envelopeId: string;
  eventType:
    | "VERIFY_ATTEMPT"
    | "VERIFY_SUCCESS"
    | "VERIFY_FAILURE"
    | "REVOKE"
    | "POLICY_BLOCK";
  occurredAt: string;
  actor?: string;
  reason?: string;
  receiptHash?: string;
}
