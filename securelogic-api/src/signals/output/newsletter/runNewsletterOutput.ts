import { runSignalPipeline } from "../../runSignalPipeline.js";
import { formatNewsletterSignal } from "./formatNewsletterSignal.js";
import { applyFilter } from "../../filter/applyFilter.js";
import { applyBucket } from "../../bucket/applyBucket.js";
import { TIER_BUCKET } from "../../bucket/tierBucketPolicy.js";
import { AccessTier } from "../../filter/FilterPolicy.js";

export async function runNewsletterOutput(tier: AccessTier) {
  const signals = await runSignalPipeline();
  const bucketed = applyBucket(signals, TIER_BUCKET[tier]);
  return bucketed.map(formatNewsletterSignal);
}
