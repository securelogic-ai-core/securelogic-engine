import type { RequestContextV1 } from "../../product/context/RequestContextV1";

import { enforcePolicy } from "../../product/policy/enforcePolicy";
import { runAuditSprint } from "../../product/integrity/createResultEnvelope";
import { emitAuditEvent } from "../../product/audit/emitAuditEvent";

export async function handleAuditSprint(input: unknown, ctx: RequestContextV1) {
  enforcePolicy(ctx, "AUDIT_SPRINT_EXECUTE");
  const envelope = runAuditSprint(input);
  emitAuditEvent({
    eventId: envelope.envelopeId,
    action: "AUDIT_SPRINT_EXECUTED"
  });
  return envelope;
}
