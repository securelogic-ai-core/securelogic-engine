/**
 * matcherAlertsFeatureFlag.ts — gate for matcher-driven real-time alerts.
 *
 * The signal→matcher→finding fan-out (runPipeline + KEV poll) historically sent
 * NO real-time alert: only the manual POST /api/findings path did. Wiring the
 * fan-out to alert is high-volume (every active org × every Critical/High match,
 * on both the hourly pipeline and the 15-minute KEV poll), so it ships behind
 * this flag, OFF by default, and is enabled per-env after a staging volume check.
 *
 * ON only when SECURELOGIC_MATCHER_ALERTS_ENABLED === "true". With the flag unset
 * (the default, and the state in staging/prod until deliberately flipped), the
 * fan-out creates no alert batcher and sends nothing — behavior is exactly as
 * before this feature.
 */
export function matcherAlertsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_MATCHER_ALERTS_ENABLED"] === "true";
}
