export type AccessTier = "PAID" | "PREVIEW";

export interface FilterPolicy {
  minRiskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}
