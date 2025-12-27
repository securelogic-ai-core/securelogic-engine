import type { RiskSeverity} from "./RiskSeverity";
import { RISK_SEVERITY } from "./RiskSeverity";

export interface ExecutiveNarrative {
  severity: RiskSeverity;
  title: string;
  summary: string;
  businessImpact: string;
  recommendedAction: string;
  drivers: string[];
}
