/**
 * briefCatchupFeatureFlag.ts — kill switch for the boot-time Tuesday catch-up.
 *
 * The Intelligence Brief's only automated trigger is an in-process node-cron
 * inside the engine web service (schedulerRunner, "0 7 * * 2"). It fires once a
 * week; if that exact process is not alive at Tuesday 07:00 UTC (deploy,
 * restart, crash, cold start), the week's edition is silently missed with no
 * external retry.
 *
 * The catch-up (briefCatchup.runBriefCatchupIfMissed) closes that gap: on boot,
 * if today is the Tuesday send day, it is past 07:00 UTC, and no brief was sent
 * yet this week, it runs the scheduler once. Because it initiates OUTBOUND email
 * (blast radius), it is DARK by default and operator-owned — enable it only
 * after staging validation, per governance.
 *
 * OFF by default. Runs ONLY when SECURELOGIC_BRIEF_CATCHUP_ENABLED === "true".
 * With the flag unset (the default), runBriefCatchupIfMissed() returns early
 * with zero DB access and sends nothing. Idempotency in briefEmailSender means
 * that even if enabled it can never double-deliver a brief.
 */
export function briefCatchupEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_BRIEF_CATCHUP_ENABLED"] === "true";
}
