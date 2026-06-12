/**
 * historicalAuthorship.ts — the `security_audit_log` slice of a self-export
 * (Decision O-1: include not just current ownership but historical authorship).
 *
 * `security_audit_log.actor_user_id` (UUID FK → users.id, added in
 * 20260527_audit_actor_user.sql) attributes each audited action to the user who
 * performed it. A self-export includes every row the subject is the actor of.
 *
 * Full-row `SELECT *` (Decision Q7) carries `ip_address` — the subject's own
 * data under Art. 15. NOTE (doc/decision conflict, see
 * docs/investigation/gdpr-pr2-phase0.md §4): Q7 also names `user_agent`, but
 * `security_audit_log` has NO `user_agent` column — that column exists only on
 * `legal_consents` (a Category-B table, covered by `buildCategoryBQueries`).
 * `SELECT *` is correct either way: it returns exactly the columns that exist.
 *
 * `security_audit_log` is append-only (immutability triggers, 20260614) and has
 * no email-typed actor column, so there is no email-match arm here — UUID only.
 */

import type { ExportQuery, ExportSubject } from "./types.js";

export const SECURITY_AUDIT_LOG_TABLE = "security_audit_log";

/** The subject's historical-authorship rows in `security_audit_log`. */
export function buildHistoricalAuthorshipQuery(subject: ExportSubject): ExportQuery {
  return {
    table: SECURITY_AUDIT_LOG_TABLE,
    category: "E",
    text: `SELECT * FROM ${SECURITY_AUDIT_LOG_TABLE} WHERE actor_user_id = $1`,
    values: [subject.userId],
    note: "historical authorship (O-1); full row incl. ip_address (Q7)",
  };
}
