import type { OpinionVerdict } from "../opinion/OpinionVerdict";
import type { OpinionScope } from "../opinion/OpinionScope";

export interface DashboardOpinionSummary {
  scope: OpinionScope;
  verdict: OpinionVerdict;
  issuedAt: string;
}
