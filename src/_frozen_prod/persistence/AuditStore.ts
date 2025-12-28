import type { AuditEventV1 } from "../audit/AuditEventV1";

export interface AuditStore {
  append(event: AuditEventV1): Promise<void>;
}
