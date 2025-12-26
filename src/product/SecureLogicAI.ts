import type { ResultEnvelopeV1 } from "./contracts";

import { createAuditSprintResult } from "./factories/AuditSprintResultFactory";
import { createResultEnvelopeV1 } from "./factories/ResultEnvelopeFactory";
import { enforceEntitlements } from "./entitlement/enforceEntitlements";
import { normalizeAuditSprintResult } from "./normalization/normalizeAuditSprintResult";
import { finalizeAuditSprintResult } from "./integrity/finalizeAuditSprintResult";
import type { Entitlements } from "./entitlement/Entitlements";

export class SecureLogicAI {
  runAuditSprint(
    input: unknown,
    entitlements: Entitlements
  ): ResultEnvelopeV1 {
    const raw = createAuditSprintResult(input);
    const gated = enforceEntitlements(raw, entitlements);
    const normalized = normalizeAuditSprintResult(gated);
    const finalized = finalizeAuditSprintResult(normalized);

    return createResultEnvelopeV1(finalized);
  }
}
