import { createResultEnvelope } from "../integrity/createResultEnvelope";
import { signResultEnvelope } from "../integrity/signResultEnvelope";
import { emitAuditEvent } from "../audit/emitAuditEvent";

export async function runAuditSprint(input: unknown) {
  const envelope = createResultEnvelope(input);
  const signed = signResultEnvelope(envelope);

  emitAuditEvent({
  tenantId: ctx.tenantId,
  actor: ctx.actorId,
  resource: "AUDIT_SPRINT",
  immutable: true,
  timestamp: new Date().toISOString(),
    eventId: signed.envelopeId,
    action: "AUDIT_SPRINT_COMPLETED"
  });

  return signed;
}
