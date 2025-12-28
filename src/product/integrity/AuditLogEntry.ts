export interface AuditLogEntry {
  envelopeId: string;
  verifiedAt: string;
  policyId: string;
  success: boolean;
  reason?: string;
}
