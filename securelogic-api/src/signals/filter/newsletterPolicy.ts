import { FilterPolicy } from "./FilterPolicy";

export const FREE_NEWSLETTER_POLICY: FilterPolicy = {
  tier: "FREE",
  minRiskBand: "HIGH",
  maxItems: 3
};

export const PAID_NEWSLETTER_POLICY: FilterPolicy = {
  tier: "PAID",
  minRiskBand: "MEDIUM"
};
