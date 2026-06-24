/**
 * dailyDigestFeatureFlag.ts — kill switch for the engine Daily Digest email.
 *
 * Product decision (2026-06-24): the Intelligence Brief is the single weekly
 * customer email. The per-user Daily Digest of new findings (engine node-cron
 * 08:00 UTC → digestScheduler.runDailyDigest → alertEmailService.sendDailyDigest)
 * is turned OFF — findings stay in-app, surfaced by real-time alerts only when a
 * Critical/High hits the customer's vendor (alertEmailService.sendCriticalFindingAlert,
 * Tier 1, which is unaffected by this flag).
 *
 * OFF by default. The Daily Digest runs ONLY when
 * SECURELOGIC_DAILY_DIGEST_ENABLED === "true". With the flag unset (the default,
 * and the intended state everywhere), runDailyDigest() returns early — no
 * recipient selection, no send. Nothing is deleted; flip the flag to restore it.
 */
export function dailyDigestEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_DAILY_DIGEST_ENABLED"] === "true";
}
