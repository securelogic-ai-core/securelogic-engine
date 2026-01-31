import { AccessTier } from "../filter/FilterPolicy";
import { TimeBucket } from "./TimeBucket";

export const TIER_BUCKET: Record<AccessTier, TimeBucket> = {
  FREE: "WEEKLY",
  PAID: "DAILY"
};
