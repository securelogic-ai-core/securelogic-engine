export type RiskSeverity =
  | "Low"
  | "Moderate"
  | "High"
  | "Critical";

export const RISK_SEVERITY = {
  Low: "Low" as RiskSeverity,
  Moderate: "Moderate" as RiskSeverity,
  High: "High" as RiskSeverity,
  Critical: "Critical" as RiskSeverity
};
