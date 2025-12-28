import { createResultEnvelope } from "../integrity/createResultEnvelope";
import { signResultEnvelope } from "../integrity/signResultEnvelope";
import { emitAuditEvent } from "../audit/emitAuditEvent";

export async function runAuditSprint(input: unknown) {
  const envelope = createResultEnvelope(input);
  const signed = signResultEnvelope(envelope);

  emitAuditEvent({
    eventId: signed.envelopeId,
    action: "AUDIT_SPRINT_COMPLETED"
  });

  return signed;
}
