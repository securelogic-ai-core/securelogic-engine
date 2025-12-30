import type { OpinionEnvelopeV1 } from "../opinion/envelope/OpinionEnvelopeV1";
import type { DashboardOpinionSummary } from "./DashboardOpinionSummary";

export function mapOpinionToDashboard(
  envelope: OpinionEnvelopeV1
): DashboardOpinionSummary {
  return {
    scope: envelope.payload.scope,
    verdict: envelope.payload.verdict,
    issuedAt: envelope.payload.issuedAt
  };
}
