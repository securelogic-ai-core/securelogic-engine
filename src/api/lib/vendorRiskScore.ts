/**
 * vendorRiskScore.ts — Pure vendor risk score computation.
 *
 * Formula: score = max(0, min(100, 100 - criticality_weight - finding_penalty))
 *
 * criticality_weight:  critical=40, high=25, medium=15, low=5, null=10
 * finding_penalty per open finding: Critical=20, High=12, Moderate=6, Low=2
 */

const CRITICALITY_WEIGHT: Record<string, number> = {
  critical: 40,
  high:     25,
  medium:   15,
  low:       5,
};

const FINDING_WEIGHT: Record<string, number> = {
  Critical: 20,
  High:     12,
  Moderate:  6,
  Low:        2,
};

export type VendorRiskScoreResult = {
  score: number;
  risk_level: string;
};

export function computeVendorRiskScore(
  criticality: string | null,
  findings: Array<{ severity: string; status: string }>
): VendorRiskScoreResult {
  const critWeight =
    criticality != null
      ? (CRITICALITY_WEIGHT[criticality.toLowerCase()] ?? 10)
      : 10;

  const findingPenalty = findings
    .filter((f) => f.status === "open" || f.status === "in_progress")
    .reduce((sum, f) => sum + (FINDING_WEIGHT[f.severity] ?? 0), 0);

  const score = Math.max(0, Math.min(100, 100 - critWeight - findingPenalty));

  const risk_level =
    score >= 75 ? "Low Risk" :
    score >= 50 ? "Moderate Risk" :
    score >= 25 ? "High Risk" :
    "Critical Risk";

  return { score, risk_level };
}
