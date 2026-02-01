import type { RequestContextV1 } from "../../product/context/RequestContextV1.js";

import { enforcePolicy } from "../../product/policy/enforcePolicy.js";
import { runAuditSprint } from "../../product/integrity/createResultEnvelope.js";
import { emitAuditEvent } from "../../product/audit/emitAuditEvent.js";

export async function handleAuditSprint(input: unknown, ctx: RequestContextV1) {
  enforcePolicy(ctx, "AUDIT_SPRINT_EXECUTE");
  const envelope = runAuditSprint(input);
  emitAuditEvent({
    eventId: envelope.envelopeId,
    action: "AUDIT_SPRINT_EXECUTED"
  });
  return envelope;
}
