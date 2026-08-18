/**
 * briefCatchupFeatureFlag.ts — kill switch for the boot-time Tuesday catch-up.
 *
 * The Intelligence Brief's only automated trigger is an in-process node-cron
 * inside the engine web service (schedulerRunner, "0 7 * * 2"). It fires once a
 * week; if that exact process is not alive at Tuesday 07:00 UTC (deploy,
 * restart, crash, cold start), or the multi-hour sequential run is killed
 * mid-loop by a deploy's SIGTERM, part or all of the week's edition is
 * silently missed with no external retry.
 *
 * The catch-up (briefCatchup.runBriefCatchupIfMissed) closes that gap: on
 * boot, on any weekday, if any eligible org lacks a published brief for the
 * current weekly window (most recent Tuesday 07:00 UTC), it runs the scheduler
 * once; the scheduler's per-org idempotency skip regenerates only the missing
 * orgs. Email delivery stays Tuesday-gated inside runScheduler (isBriefSendDay)
 * — a Wednesday+ catch-up generates in-platform briefs but sends no email.
 * Because a same-Tuesday catch-up can initiate OUTBOUND email (blast radius),
 * the flag is DARK by default and operator-owned — enable it only after
 * staging validation, per governance.
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
