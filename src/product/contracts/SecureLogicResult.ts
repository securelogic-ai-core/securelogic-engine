import { RiskDecision } from "../../engine/contracts/RiskDecision";
import { ExecutiveRiskReportV2 } from "../../report/contracts/ExecutiveRiskReportV2";

export type SecureLogicResult =
  | { decision: RiskDecision }
  | { decision: RiskDecision; report: ExecutiveRiskReportV2 };
