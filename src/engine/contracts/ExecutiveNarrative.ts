import type { RiskSeverity} from "./RiskSeverity.js";
import { RISK_SEVERITY } from "./RiskSeverity.js";

export interface ExecutiveNarrative {
  severity: RiskSeverity;
  title: string;
  summary: string;
  businessImpact: string;
  recommendedAction: string;
  drivers: string[];
}
