/**
 * tdgPolicy.ts — the DB-free activation and eligibility rules for TDG.
 *
 * TWO INDEPENDENT GATES stand between this code and a deleted row, and both are
 * off by default:
 *
 *   1. SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED — off means the enqueuer
 *      returns 0 without touching the database, the worker claims no sweep
 *      jobs, and the destructive routes are not mounted.
 *   2. SECURELOGIC_TDG_EFFECTIVE_FROM — an ISO date. UNSET MEANS ZERO
 *      DELETIONS, EVER, even with the flag on. Planning and dry-run still work.
 *
 * The second gate exists because the first one is not enough. A flag answers
 * "is the feature on"; it does not answer "has this organization been under a
 * declared retention policy long enough that deleting its data is legitimate".
 * Turning a sweeper on against data that predates the policy is how a retention
 * feature becomes a data-loss incident, so the grandfather rule below is a
 * platform property rather than a per-org migration.
 */

/** The sweeper's durable job type (migration 20261015). */
export const RETENTION_SWEEP_JOB_TYPE = "retention_sweep" as const;

/**
 * Days an organization must have spent under a declared policy before ANY
 * object of theirs can expire. Not tunable per tenant: it protects against our
 * own activation, not against a customer's configuration.
 */
export const TDG_GRACE_DAYS = 30;

export function tenantDataGovernanceEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"] === "true";
}

/**
 * The declared activation date, or null when unset/unparseable. Unparseable is
 * deliberately indistinguishable from unset: a typo in this variable must fail
 * closed (no deletions), never fall back to "now".
 */
export function tdgEffectiveFrom(
  env: NodeJS.ProcessEnv = process.env
): Date | null {
  const raw = env["SECURELOGIC_TDG_EFFECTIVE_FROM"];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Milliseconds in a day. Retention is expressed in whole days everywhere. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * TDG-9 grandfathering. Deletions are permitted only once the grace window has
 * elapsed since the declared activation date. Null effective-from → never.
 */
export function deletionsPermitted(
  now: Date = new Date(),
  effectiveFrom: Date | null = tdgEffectiveFrom()
): boolean {
  if (!effectiveFrom) return false;
  return now.getTime() >= effectiveFrom.getTime() + TDG_GRACE_DAYS * DAY_MS;
}

/**
 * The age cutoff for a retention period: objects whose age anchor is at or
 * before this instant are eligible. Pure, so the same inputs always produce the
 * same cutoff (TDG-9, determinism).
 */
export function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * Why a sweep would delete nothing, for the dry-run report and the logs. An
 * empty array means deletion is permitted.
 */
export function activationBlockers(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): string[] {
  const blockers: string[] = [];
  if (!tenantDataGovernanceEnabled(env)) blockers.push("flag_disabled");
  const from = tdgEffectiveFrom(env);
  if (!from) {
    blockers.push("effective_from_unset");
  } else if (!deletionsPermitted(now, from)) {
    blockers.push("grace_window_open");
  }
  return blockers;
}
