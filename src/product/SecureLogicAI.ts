import type { ResultEnvelope } from "./contracts";
import type { Entitlements } from "./entitlement/Entitlements";

import { createAuditSprintResult } from "./factories/AuditSprintResultFactory";
import { createResultEnvelopeV1 } from "./factories/ResultEnvelopeFactory";
import { enforceEntitlements } from "./entitlement/enforceEntitlements";
import { normalizeAuditSprintResult } from "./normalization/normalizeAuditSprintResult";
import { finalizeAuditSprintResult } from "./integrity/finalizeAuditSprintResult";
import { signResultEnvelope } from "./signing/signResultEnvelope";

export class SecureLogicAI {
  runAuditSprint(
    input: unknown,
    entitlements: Entitlements
  ): ResultEnvelope {
    const raw = createAuditSprintResult(input);
    const gated = enforceEntitlements(raw, entitlements);
    const normalized = normalizeAuditSprintResult(gated);
    const finalized = finalizeAuditSprintResult(normalized);

    return signResultEnvelope(createResultEnvelopeV1(finalized));
  }
}
