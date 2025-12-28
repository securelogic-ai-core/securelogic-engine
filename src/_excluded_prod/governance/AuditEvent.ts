export type AuditEventType =
  | "VERIFY_ATTEMPT"
  | "VERIFY_SUCCESS"
  | "VERIFY_FAILURE"
  | "POLICY_DENY"
  | "REVOKE"
  | "KEY_ROTATION";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  envelopeId?: string;
  actor?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}
