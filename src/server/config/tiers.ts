import { ApiTier } from "./apiKeys";

export const TIER_LIMITS: Record<ApiTier, number> = {
  free: 60,
  pro: 600,
  enterprise: 1000000
};
