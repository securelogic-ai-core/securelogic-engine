import type { AuditEventV1 } from "./AuditEventV1";

export interface AuditSink {
  append(event: AuditEventV1): void;
}
