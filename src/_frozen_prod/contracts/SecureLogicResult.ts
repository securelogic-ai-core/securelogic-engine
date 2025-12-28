import type { RiskDecision } from "../../engine/contracts/RiskDecision";
import type { ExecutiveRiskReportV2 } from "../../report/contracts/ExecutiveRiskReportV2";

export type SecureLogicResult =
  | { decision: RiskDecision }
  | { decision: RiskDecision; report: ExecutiveRiskReportV2 };
