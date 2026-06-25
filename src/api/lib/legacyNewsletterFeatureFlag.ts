/**
 * legacyNewsletterFeatureFlag.ts — kill switch for the legacy worker Newsletter.
 *
 * The intelligence-worker pipeline historically generated and emailed a daily
 * "Newsletter" once per UTC day inside runPipeline.ts:
 *
 *     generateNewsletter()  →  newsletter_issues   (content from the `signals` table)
 *     promoteIssueToQueued()                        (draft → queued)
 *     generateNewsletterDeliveries()  →  newsletter_deliveries  (from the `subscribers` list)
 *     sendNewsletter()  →  Resend                   (the customer email)
 *
 * This path is SEPARATE from — and duplicative of — the canonical Intelligence
 * Brief, which the engine produces and sends on its own daily cron:
 *
 *     briefScheduler.runScheduler()  →  intelligence_briefs / intelligence_brief_items
 *     sendBrief() (briefEmailSender.ts)  →  Resend  (to intelligence_brief_subscribers)
 *
 * A paying customer is enrolled in BOTH lists by the Stripe webhook
 * (stripeWebhook.ts writes intelligence_brief_subscribers AND subscribers), so
 * with the legacy path live a customer could receive two daily emails from two
 * pipelines an hour apart (Brief at 07:00 UTC, Newsletter at 08:00 UTC).
 *
 * OFF by default. The legacy Newsletter path runs ONLY when
 * SECURELOGIC_LEGACY_NEWSLETTER_ENABLED === "true". With the flag unset (the
 * default, and the intended state in staging and production), the worker
 * performs NO newsletter generation, promotion, delivery-queueing, or send —
 * leaving the Intelligence Brief as the sole daily customer email path.
 *
 * The flag lives on the intelligence-worker service only. It has no effect on
 * the engine Brief pipeline, which runs in a different service and reads a
 * different signal table and subscriber list.
 */
export function legacyNewsletterEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_LEGACY_NEWSLETTER_ENABLED"] === "true";
}
