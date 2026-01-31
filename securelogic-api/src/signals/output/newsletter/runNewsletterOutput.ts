import { runSignalPipeline } from "../../runSignalPipeline";
import { formatNewsletterSignal } from "./formatNewsletterSignal";
import { applyFilter } from "../../filter/applyFilter";
import { applyBucket } from "../../bucket/applyBucket";
import { TIER_BUCKET } from "../../bucket/tierBucketPolicy";
import {
  FREE_NEWSLETTER_POLICY,
  PAID_NEWSLETTER_POLICY
} from "../../filter/newsletterPolicy";

export async function runNewsletterOutput(
  tier: "FREE" | "PAID"
) {
  const signals = await runSignalPipeline();

  const policy =
    tier === "FREE"
      ? FREE_NEWSLETTER_POLICY
      : PAID_NEWSLETTER_POLICY;

  const bucketed = applyBucket(signals, TIER_BUCKET[tier]);
  const filtered = applyFilter(bucketed, policy);

  return filtered.map(formatNewsletterSignal);
}