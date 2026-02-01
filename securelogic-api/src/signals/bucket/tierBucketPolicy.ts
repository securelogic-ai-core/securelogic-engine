import { AccessTier } from "../filter/FilterPolicy.js";
import { TimeBucket } from "./TimeBucket.js";

export const TIER_BUCKET: Record<AccessTier, TimeBucket> = {
  PREVIEW: "WEEKLY",
  PAID: "DAILY"
};
