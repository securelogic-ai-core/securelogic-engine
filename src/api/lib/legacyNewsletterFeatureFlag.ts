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
 * Brief, which the engine produces on its own weekly cron (Tuesday 07:00 UTC,
 * schedulerRunner.ts):
 *
 *     briefScheduler.runScheduler()  →  intelligence_briefs / intelligence_brief_items
 *     sendBrief() (briefEmailSender.ts)  →  Resend  (to intelligence_brief_subscribers)
 *
 * Historically the Stripe webhook enrolled a paying customer in BOTH lists, so
 * with the legacy path live a customer could receive two emails from two
 * pipelines an hour apart. The webhook no longer writes the legacy
 * `subscribers` list (2026-06-24 policy; asserted by emailCadence.test.ts) —
 * it enrolls only `intelligence_brief_subscribers`, which under ADR-0007 is an
 * email-recipient list and never gates brief generation.
 *
 * OFF by default. The legacy Newsletter path runs ONLY when
 * SECURELOGIC_LEGACY_NEWSLETTER_ENABLED === "true". With the flag unset (the
 * default, and the intended state in staging and production), the worker
 * performs NO newsletter generation, promotion, delivery-queueing, or send —
 * leaving the Intelligence Brief as the sole recurring customer email path.
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
