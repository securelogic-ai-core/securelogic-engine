/**
 * startupCheck.ts — Async startup validation run before the server begins serving.
 *
 * Complements validateEnv.ts (synchronous, module-load-time checks) by handling
 * the async portion of startup validation:
 *   - RESEND_API_KEY presence warning (email delivery will fail silently if absent)
 *   - Database connectivity probe (SELECT 1 — required to proceed in all environments)
 *
 * The following are validated synchronously in validateEnv.ts (called before this):
 *   - NODE_ENV           — must be set; unknown values are fatal
 *   - DATABASE_URL       — must be set in production
 *   - ANTHROPIC_API_KEY  — warns if absent
 *   - SCHEDULER_SECRET   — must be ≥ 32 chars; fatal in production if absent
 *   - FIELD_ENCRYPTION_KEY — must be 64 hex chars; fatal in production if absent
 *
 * startupCheck() MUST be awaited before startScheduler() so the server does
 * not begin accepting scheduled work without a confirmed database connection.
 *
 * Failure policy (matches the rest of the platform):
 *   - Missing optional services → log warning, continue
 *   - DB connectivity failure   → log fatal, exit(1) in all environments
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  assertSafeWebhookUrl,
  UnsafeWebhookUrlError,
} from "../lib/webhookUrlSafety.js";

const isProd = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function warnIfMissing(key: string, consequence: string): void {
  const val = (process.env[key] ?? "").trim();
  if (!val) {
    logger.warn(
      { event: "startup_check_missing_env", key },
      `${key} is not set — ${consequence}`
    );
  }
}

async function probeDatabase(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL ?? "").trim();

  if (!dbUrl) {
    // validateEnv already catches this in production.
    // In development, log a warning but do not block startup.
    logger.warn(
      { event: "startup_db_url_missing" },
      "DATABASE_URL is not set — database connectivity probe skipped"
    );
    return;
  }

  const client = await pg.connect();
  try {
    await client.query("SELECT 1");
    logger.info({ event: "startup_db_ok" }, "Database connectivity confirmed");
  } catch (err) {
    logger.fatal(
      { event: "startup_db_failed", err },
      "Database connectivity probe failed — cannot start server"
    );
    process.exit(1);
  } finally {
    client.release();
  }
}

/**
 * SSRF dry-run audit (A10-G1): the new SSRF guard is enforced at write/PATCH
 * time, but pre-existing webhook_endpoints rows were written before the
 * validator existed. Run the validator against every active row at boot and
 * warn-log any that would now be rejected. No auto-disable — operator
 * reviews logs and contacts affected customers manually.
 *
 * Failures during the audit (DB errors, DNS storms) are logged and swallowed —
 * the audit must never block startup.
 */
async function auditExistingWebhookUrls(): Promise<void> {
  try {
    const result = await pg.query<{ id: string; organization_id: string; url: string }>(
      `SELECT id, organization_id, url
         FROM webhook_endpoints
        WHERE status = 'active'`
    );

    if (result.rows.length === 0) {
      logger.info(
        { event: "startup_webhook_url_audit_empty" },
        "No active webhook endpoints to audit"
      );
      return;
    }

    let unsafeCount = 0;

    await Promise.allSettled(
      result.rows.map(async (row) => {
        try {
          await assertSafeWebhookUrl(row.url);
        } catch (err) {
          if (err instanceof UnsafeWebhookUrlError) {
            unsafeCount += 1;
            logger.warn(
              {
                event: "startup_webhook_url_audit_unsafe",
                endpoint_id: row.id,
                organization_id: row.organization_id,
                reason: err.reason,
                detail: err.detail,
              },
              "Existing webhook endpoint would now fail SSRF validation — contact customer (no auto-disable)"
            );
          }
        }
      })
    );

    logger.info(
      {
        event: "startup_webhook_url_audit_complete",
        total: result.rows.length,
        unsafe: unsafeCount,
      },
      "Webhook URL safety audit complete"
    );
  } catch (err) {
    logger.error(
      { event: "startup_webhook_url_audit_failed", err },
      "Webhook URL audit failed (non-fatal) — startup continues"
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run async startup checks before the scheduler starts and the server
 * begins accepting requests.
 *
 * Call order in server.ts:
 *   validateEnv()            — synchronous env checks (already called)
 *   await connectDatabase()  — pool initialisation
 *   await startupCheck()     — this function
 *   startScheduler()
 *   app.listen()
 */
export async function startupCheck(): Promise<void> {
  // Warn about soft-required service keys. These do not block startup but
  // their absence causes silent feature degradation in production.
  warnIfMissing(
    "RESEND_API_KEY",
    "email delivery (recovery emails, brief delivery) will fail silently"
  );

  // Redundant with validateEnv but guards against the case where startupCheck
  // is called without validateEnv having run first (e.g. test harnesses).
  warnIfMissing(
    "ANTHROPIC_API_KEY",
    "intelligence brief generation will be unavailable"
  );

  // Probe actual database connectivity — required to accept any traffic.
  await probeDatabase();

  // SSRF audit of existing webhook URLs (A10-G1). Non-fatal — just logs.
  await auditExistingWebhookUrls();

  if (isProd) {
    logger.info(
      { event: "startup_checks_passed", env: "production" },
      "All startup checks passed"
    );
  } else {
    logger.info(
      { event: "startup_checks_passed", env: process.env.NODE_ENV ?? "unknown" },
      "Startup checks passed"
    );
  }
}
