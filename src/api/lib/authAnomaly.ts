/**
 * authAnomaly.ts — Authentication-anomaly detection & alerting (A04-G4 / A09-G2).
 *
 * Two tiers, both routing to the operator webhook via sendSecurityAlert:
 *
 *   Tier 1 — recordAccountLockout(): synchronous. Called from the login
 *     handler at the moment an account crosses the failed-attempt lockout
 *     threshold. Emits a distinct `auth.account_locked` audit event and an
 *     operator alert.
 *
 *   Tier 2 — runAuthAnomalyScan(): scheduled. Scans security_audit_log for
 *     credential-stuffing and API-key-probing patterns. Registered as a
 *     5-minute cron in schedulerRunner.ts — it runs inside the engine web
 *     service's node-cron host, NOT a worker, so the auth_anomaly_alerts
 *     dedup-ledger migration auto-applies on engine deploy.
 *
 * Dedup (Tier 2): the auth_anomaly_alerts ledger. An over-threshold IP is
 * alerted at most once per LEDGER_COOLDOWN_HOURS; the claim is an atomic
 * INSERT ... ON CONFLICT DO UPDATE so a re-detection inside the cooldown
 * window is skipped. The scan window deliberately exceeds the cron interval
 * so a burst straddling a run boundary is still caught whole.
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "./auditLog.js";
import { sendSecurityAlert } from "../infra/alerting.js";

// ---------------------------------------------------------------------------
// Tunable detection parameters
// ---------------------------------------------------------------------------

/** Lookback window for each Tier 2 scan. Deliberately larger than the cron
 *  interval (5 min) so a slow burst spanning runs is caught in one window. */
export const SCAN_WINDOW_MINUTES = 15;

/**
 * Credential stuffing: number of DISTINCT accounts hit by `auth.login_failed`
 * from a single IP within the window before an alert fires.
 *
 * IMPORTANT — distinct accounts are counted by the MASKED email that
 * `auth.login_failed` records (first 4 chars + "***"). Two real emails that
 * share their first 4 characters collide and UNDERCOUNT the distinct total.
 * This errs SAFE: it can only delay a detection, never manufacture a false
 * positive. Do NOT "fix" this by recording the full email in the audit
 * payload — that would widen PII exposure in the audit log to remove a
 * non-problem.
 */
export const CRED_STUFFING_DISTINCT_ACCOUNTS = 10;

/** API-key probing: number of `auth.invalid_api_key` events from a single IP
 *  within the window before an alert fires. */
export const API_KEY_PROBE_COUNT = 20;

/** An over-threshold IP is re-alerted at most once per this many hours. */
export const LEDGER_COOLDOWN_HOURS = 6;

type AnomalyType = "credential_stuffing" | "api_key_probing";

// ---------------------------------------------------------------------------
// Tier 1 — synchronous account-lockout signal
// ---------------------------------------------------------------------------

/**
 * Record an account lockout: a distinct high-severity audit event plus an
 * operator alert. Called from the login handler at the lockout point.
 *
 * Resolves even if the webhook fails — the audit event is the durable record;
 * webhook delivery is best-effort. Callers may treat this as fire-and-forget.
 */
export async function recordAccountLockout(args: {
  userId: string;
  organizationId: string;
  ip: string | null;
  failedAttempts: number;
  lockedUntil: Date;
  maskedEmail: string;
}): Promise<void> {
  writeAuditEvent({
    organizationId: args.organizationId,
    actorUserId: args.userId,
    eventType: "auth.account_locked",
    resourceType: "user",
    resourceId: args.userId,
    payload: {
      failed_attempts: args.failedAttempts,
      locked_until: args.lockedUntil.toISOString(),
      email: args.maskedEmail
    },
    ipAddress: args.ip
  });

  try {
    await sendSecurityAlert({
      kind: "account_locked",
      summary: `Account locked after ${args.failedAttempts} failed login attempts`,
      detail: {
        user_id: args.userId,
        organization_id: args.organizationId,
        email: args.maskedEmail,
        ip: args.ip,
        locked_until: args.lockedUntil.toISOString()
      }
    });
  } catch (err) {
    logger.error(
      { event: "account_lockout_alert_delivery_failed", userId: args.userId, err },
      "Account-lockout security alert webhook delivery failed (lockout still recorded in audit log)"
    );
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — scheduled audit-log scan
// ---------------------------------------------------------------------------

/**
 * Atomically claim the (anomaly_type, subject) dedup slot. Returns true when
 * this caller won the claim and should fire an alert; false when the slot was
 * already claimed within LEDGER_COOLDOWN_HOURS (re-detection — skip).
 */
async function claimAnomalySlot(anomalyType: AnomalyType, subject: string): Promise<boolean> {
  const claim = await pg.query(
    `INSERT INTO auth_anomaly_alerts (anomaly_type, subject)
     VALUES ($1, $2)
     ON CONFLICT (anomaly_type, subject) DO UPDATE
       SET last_alerted_at = NOW(),
           alert_count = auth_anomaly_alerts.alert_count + 1
       WHERE auth_anomaly_alerts.last_alerted_at
             < NOW() - make_interval(hours => $3::int)
     RETURNING id`,
    [anomalyType, subject, LEDGER_COOLDOWN_HOURS]
  );
  return (claim.rowCount ?? 0) > 0;
}

/**
 * Handle one over-threshold IP: claim the dedup slot, and if won, write the
 * durable `security.auth_anomaly_detected` audit event and attempt operator
 * delivery. The audit event is written even when webhook delivery fails — it
 * is the guaranteed detection record. Returns true when an alert was handled.
 */
async function handleAnomaly(
  anomalyType: AnomalyType,
  ip: string,
  summary: string,
  detail: Record<string, unknown>
): Promise<boolean> {
  if (!(await claimAnomalySlot(anomalyType, ip))) return false;

  writeAuditEvent({
    eventType: "security.auth_anomaly_detected",
    resourceType: "ip_address",
    payload: { anomaly_type: anomalyType, ip, ...detail },
    ipAddress: ip
  });

  try {
    await sendSecurityAlert({ kind: anomalyType, summary, detail: { ip, ...detail } });
  } catch (err) {
    logger.error(
      { event: "auth_anomaly_alert_delivery_failed", anomalyType, ip, err },
      "Auth-anomaly security alert webhook delivery failed (detection still recorded in audit log)"
    );
  }
  return true;
}

/**
 * Scan security_audit_log over the last SCAN_WINDOW_MINUTES for
 * credential-stuffing and API-key-probing patterns and alert on over-threshold
 * source IPs. Idempotent across runs via the auth_anomaly_alerts ledger.
 */
export async function runAuthAnomalyScan(): Promise<{
  credentialStuffingIps: number;
  apiKeyProbingIps: number;
  alertsFired: number;
}> {
  const since = new Date(Date.now() - SCAN_WINDOW_MINUTES * 60 * 1000);
  let alertsFired = 0;

  // Credential stuffing — one IP -> many distinct accounts via auth.login_failed.
  const stuffing = await pg.query<{ ip_address: string; account_count: string }>(
    `SELECT ip_address, COUNT(DISTINCT payload->>'email') AS account_count
       FROM security_audit_log
      WHERE event_type = 'auth.login_failed'
        AND created_at >= $1
        AND ip_address IS NOT NULL
      GROUP BY ip_address
     HAVING COUNT(DISTINCT payload->>'email') >= $2`,
    [since, CRED_STUFFING_DISTINCT_ACCOUNTS]
  );
  for (const row of stuffing.rows) {
    const accounts = Number(row.account_count);
    const handled = await handleAnomaly(
      "credential_stuffing",
      row.ip_address,
      `Possible credential stuffing — ${accounts} accounts targeted from one IP in ${SCAN_WINDOW_MINUTES}m`,
      { distinct_accounts: accounts, window_minutes: SCAN_WINDOW_MINUTES, threshold: CRED_STUFFING_DISTINCT_ACCOUNTS }
    );
    if (handled) alertsFired++;
  }

  // API-key probing — one IP -> many auth.invalid_api_key hits.
  const probing = await pg.query<{ ip_address: string; hit_count: string }>(
    `SELECT ip_address, COUNT(*) AS hit_count
       FROM security_audit_log
      WHERE event_type = 'auth.invalid_api_key'
        AND created_at >= $1
        AND ip_address IS NOT NULL
      GROUP BY ip_address
     HAVING COUNT(*) >= $2`,
    [since, API_KEY_PROBE_COUNT]
  );
  for (const row of probing.rows) {
    const hits = Number(row.hit_count);
    const handled = await handleAnomaly(
      "api_key_probing",
      row.ip_address,
      `Possible API-key probing — ${hits} invalid-key attempts from one IP in ${SCAN_WINDOW_MINUTES}m`,
      { invalid_key_hits: hits, window_minutes: SCAN_WINDOW_MINUTES, threshold: API_KEY_PROBE_COUNT }
    );
    if (handled) alertsFired++;
  }

  return {
    credentialStuffingIps: stuffing.rows.length,
    apiKeyProbingIps: probing.rows.length,
    alertsFired
  };
}
