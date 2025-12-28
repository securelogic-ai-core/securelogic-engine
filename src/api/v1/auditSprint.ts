import { enforcePolicy } from "../../product/policy/enforcePolicy";
import { runAuditSprint } from "../../product/integrity/createResultEnvelope";
import { emitAuditEvent } from "../../product/audit/emitAuditEvent";

export async function handleAuditSprint(input: unknown, ctx: unknown) {
  enforcePolicy(ctx, "AUDIT_SPRINT_EXECUTE");
  const envelope = runAuditSprint(input);
  emitAuditEvent({
    eventId: envelope.envelopeId,
    action: "AUDIT_SPRINT_EXECUTED"
  });
  return envelope;
}
