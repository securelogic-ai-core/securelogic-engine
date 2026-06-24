/**
 * accountDeletionReaperPolicy.ts — DB-free policy for the GDPR Art.17
 * account-deletion reaper (PR #6). No import of infra/postgres (which throws at
 * module-eval when DATABASE_URL is unset), so the erasure SQL builder and the
 * settled decision-locks are unit-testable without a database — same split as
 * dataRightsWorkerPolicy.ts.
 *
 * The whole reaper feature is INERT unless SECURELOGIC_ACCOUNT_DELETION_REAPER_
 * ENABLED === "true": the enqueuer cron produces no jobs and the worker claims
 * no reap jobs while the flag is off. Erasure is irreversible only at the
 * single Phase-1 COMMIT; everything before it is a no-op the cancel path undoes.
 *
 * Decision-locks honoured (Phase-0 determination, all 10 settled):
 *   D-1  transitive tombstone — never SET NULL on actor UUID FKs; scrubbing the
 *        users row anonymizes them for free. We tombstone users, delete the
 *        user-scoped Category-B rows explicitly (CASCADE never fires under the
 *        tombstone), and leave the FK references intact.
 *   D-2  legal_consents — RETAIN the consent skeleton, SCRUB ip_address +
 *        user_agent only (Art.17(3)(b)/(e) — demonstrate-consent + legal claims).
 *   D-3  org_invites — LEAVE (PII is the invitee's, not the deleted sender's).
 *   D-4  email_provider_events — LEAVE (Category-E, no org column).
 *   D-5  self-deletion only (Increment 1) — org deletion + admin-member delete
 *        are out of scope.
 *   D-6  30-day grace — user or requesting admin may cancel until the reap.
 *   D-7  inline R2 purge — the reaper purges the user's export bundles after the
 *        PG commit (export_file_purge TTL sweep stays separate / out of scope).
 *   D-8  scrub data_export_files.downloaded_from_ip, KEEP the row, set purged_at.
 *   D-9  no-org email tables (subscribers / newsletter_deliveries /
 *        email_suppressions / email_provider_events) — the reaper NEVER writes
 *        to a no-org table (Disposition A). Standalone unsubscribe is the path.
 *   D-10 a cron enqueuer is the SOLE producer of account_deletion_reap jobs.
 */

import { TOMBSTONE_USER_PATCH } from "./dataClassification.js";

/** The reaper feature flag. Off by default — the build lands INERT in prod. */
export function accountDeletionReaperEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_ACCOUNT_DELETION_REAPER_ENABLED"] === "true";
}

/** D-6: grace window between a deletion request and the reap. */
export const DELETION_GRACE_DAYS = 30;

/** The reaper's job type (already a valid jobs.job_type, migration 20260622). */
export const ACCOUNT_DELETION_REAP_JOB_TYPE = "account_deletion_reap" as const;

/**
 * Job types the data-rights worker claims. Exports are always claimable; the
 * reap type is claimed ONLY when the reaper flag is on, so reap jobs (which the
 * gated enqueuer also won't produce while off) are never drained when disabled.
 */
export function claimedJobTypes(reaperEnabled: boolean): string[] {
  return reaperEnabled
    ? ["data_export_self", "data_export_org", ACCOUNT_DELETION_REAP_JOB_TYPE]
    : ["data_export_self", "data_export_org"];
}

/**
 * Customer-data tables carrying a DEPRECATED free-TEXT `reviewer_id` that may
 * hold a raw email/name (the FK `reviewer_uuid` is handled transitively by the
 * tombstone, D-1). Scrubbed by matching the subject's still-live email BEFORE
 * the users row is tombstoned. All are org-scoped (organization_id NOT NULL).
 * A fixed allowlist — these identifiers are interpolated into SQL, never user
 * input.
 */
export const REVIEWER_TEXT_TABLES: readonly string[] = [
  "risk_treatments",
  "obligation_assessments",
  "vendor_reviews",
  "ai_governance_assessments",
  "dependency_assessments",
];

/**
 * Category-B tables that die with the user and are deleted explicitly (CASCADE
 * never fires — the users row is tombstoned, not deleted). `org_invites` (D-3)
 * and `legal_consents` (D-2) are deliberately NOT here. dashboard_preferences
 * also carries org_default rows with user_id NULL — those are left (the delete
 * is keyed on user_id, which is NULL for them).
 */
export const CATEGORY_B_DELETE_TABLES: readonly string[] = [
  "password_history",
  "user_alert_preferences",
  "alert_sends",
  "dashboard_preferences",
];

/**
 * Build the `users` tombstone UPDATE from the drift-tested TOMBSTONE_USER_PATCH
 * (the single source of truth, mirrored in DATA_CLASSIFICATION.md). Resolves the
 * "{id}" token (→ the user's UUID, keeping the scrubbed email globally unique)
 * and "{now}" (→ the reap timestamp). The WHERE clause pins
 * status='pending_deletion' so a re-claimed/already-reaped job affects 0 rows
 * (idempotency). Column names come only from the trusted constant's keys.
 */
export function buildTombstoneUpdate(
  userId: string,
  organizationId: string,
  now: Date
): { sql: string; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [col, raw] of Object.entries(TOMBSTONE_USER_PATCH)) {
    let value: unknown = raw;
    if (raw === "{now}") {
      value = now;
    } else if (typeof raw === "string" && raw.includes("{id}")) {
      value = raw.replace("{id}", userId);
    }
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }

  params.push(userId);
  const userIdx = params.length;
  params.push(organizationId);
  const orgIdx = params.length;

  const sql =
    `UPDATE users SET ${sets.join(", ")} ` +
    `WHERE id = $${userIdx} AND organization_id = $${orgIdx} ` +
    `AND status = 'pending_deletion'`;

  return { sql, params };
}
