import type { RiskSeverity} from "./RiskSeverity";
import { RISK_SEVERITY } from "./RiskSeverity";

/* ---------- Domain & Category ---------- */

export interface DomainRiskScore {
  domain: string;
  score: number;
  severity: RiskSeverity;
  impact?: number;
  likelihood?: number;
}

export interface CategoryRiskScore {
  category: string;
  score: number;
  severity: RiskSeverity;
}

/* ---------- Remediation ---------- */

export type RemediationPriority =
  | "Immediate"
  | "Short-Term"
  | "Planned";

export interface RemediationAction {
  id: string;
  description: string;
  estimatedRiskReduction: number;
  priority: RemediationPriority;
}

/* ---------- Enterprise Summary ---------- */

export interface EnterpriseRiskSummary {
  /* Quantitative */
  overallScore: number;
  enterpriseRiskScore: number;

  /* Severity */
  severity: RiskSeverity;

  /* Breakdown */
  domainScores: DomainRiskScore[];
  categoryScores: CategoryRiskScore[];

  /* Decision Drivers */
  topRiskDrivers: string[];
  severityRationale: string[];

  /* Remediation */
  recommendedActions: RemediationAction[];
}