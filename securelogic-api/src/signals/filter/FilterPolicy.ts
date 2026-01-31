export type AccessTier = "FREE" | "PAID";

export interface FilterPolicy {
  tier: AccessTier;
  minRiskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  maxItems?: number;
}
