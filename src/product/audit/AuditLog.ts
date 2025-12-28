import type { AuditEventV1 } from "./AuditEventV1";

export interface AuditLog {
  append(event: AuditEventV1): Promise<void>;
}
