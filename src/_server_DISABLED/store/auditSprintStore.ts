import type { AuditSprintResult } from "../../engine/contracts/AuditSprintResult";

type StoredAudit = {
  email: string;
  result: AuditSprintResult;
};

const store = new Map<string, StoredAudit>();

export function saveAuditResult(auditId: string, email: string, result: AuditSprintResult) {
  store.set(auditId, { email, result });
}

export function getAuditResult(auditId: string, email: string): AuditSprintResult | null {
  const record = store.get(auditId);
  if (!record) return null;
  if (record.email !== email) return null;
  return record.result;
}
