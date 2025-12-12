import { RiskSeverity } from "./RiskSeverity";

export interface ExecutiveNarrative {
  severity: RiskSeverity;
  title: string;
  summary: string;
  businessImpact: string;
  recommendedAction: string;
  drivers: string[];
}
