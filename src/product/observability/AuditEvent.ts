export type AuditEventType =
  | "VERIFY_START"
  | "VERIFY_SUCCESS"
  | "VERIFY_FAILURE"
  | "POLICY_BLOCK"
  | "SIGNATURE_REJECTED"
  | "ATTESTATION_REJECTED";

export interface AuditEvent {
  id: string;
  envelopeId?: string;
  type: AuditEventType;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
