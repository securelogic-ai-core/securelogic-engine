import { createResultEnvelopeV1 } from "../../product/envelope/createResultEnvelopeV1";
import type { AuditSprintResultV1 } from "@securelogic/contracts";

export function buildTestResultEnvelope(result?: AuditSprintResultV1) {
  return createResultEnvelopeV1({
    result: result ?? ({} as AuditSprintResultV1),
    issuedAt: new Date().toISOString(),
  });
}
