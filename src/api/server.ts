import "dotenv/config";

import { initSentry } from "./lib/sentry.js";

import { validateEnv } from "./startup/validateEnv.js";
import { runSelfTest } from "./startup/selfTest.js";
import { connectDatabase } from "./startup/connectDatabase.js";
import { startupCheck } from "./startup/startupCheck.js";

import { ensureRedisConnected, redisReady } from "./infra/redis.js";
import { logger } from "./infra/logger.js";

import { startScheduler } from "./lib/schedulerRunner.js";
import { runBriefCatchupIfMissed } from "./lib/briefCatchup.js";
import { startAccountDeletionReaperEnqueuer } from "./lib/accountDeletionEnqueuer.js";
import { startRetentionSweepEnqueuer } from "./lib/governance/retentionSweepEnqueuer.js";
import { startApplicabilityReassessmentWorker } from "./workers/applicabilityReassessmentWorker.js";
import { startConnectorSyncWorker } from "./workers/connectorSyncWorker.js";
import { startConnectorWritebackWorker } from "./workers/connectorWritebackWorker.js";
import { startRiskHistoryWorker } from "./workers/riskHistoryWorker.js";
import { startRiskAcceptanceExpiryWorker } from "./workers/riskAcceptanceExpiryWorker.js";
import { startVendorAssuranceMonitoringWorker } from "./workers/vendorAssuranceMonitoringWorker.js";
import { startPredictiveForecastWorker } from "./workers/predictiveForecastWorker.js";
import { startOrchestrationPlaybookWorker } from "./workers/orchestrationPlaybookWorker.js";
import { startWebhookRetryWorker } from "./workers/webhookRetryWorker.js";
import { startExportFilePurgeWorker } from "./workers/exportFilePurgeWorker.js";
import { createApp } from "./app.js";

/* =========================================================
   PROCESS ENTRYPOINT

   server.ts owns everything that is NOT request handling:
   boot-time guards, the drain flag, database connection, the
   startup check, the scheduler, port binding, and graceful
   shutdown. The application itself — the entire middleware
   chain and route tree — is built by createApp() in app.ts.
   ========================================================= */

/* =========================================================
   SENTRY (FIRST EXECUTABLE STATEMENT)

   Initialize error tracking before the boot guards so any throw they
   produce is captured. NOTE (ESM): top-level imports above are hoisted and
   evaluated before this runs, so Sentry's automatic incoming-HTTP tracing
   instrumentation is not fully applied — error capture is unaffected. See the
   ordering note in lib/sentry.ts. No-op (with a log line) when
   SENTRY_DSN_ENGINE is unset; never throws.
   ========================================================= */

initSentry();

/* =========================================================
   BOOT-TIME GUARDS
   ========================================================= */

validateEnv();
runSelfTest();

/* =========================================================
   RUNTIME CONFIG
   ========================================================= */

const PORT = Number(process.env.PORT ?? 4000);

const nodeEnv = (process.env.NODE_ENV ?? "").trim();
const isDev = nodeEnv === "development";
const isProd = nodeEnv === "production";

const debugEnabled =
  isDev && (process.env.ENABLE_DEBUG_ROUTES ?? "").trim() === "true";

const publicApiDisabled =
  (process.env.SECURELOGIC_DISABLE_PUBLIC_API ?? "").trim().toLowerCase() ===
  "true";

/* =========================================================
   DRAIN MODE (GRACEFUL SHUTDOWN + FAIL CLOSED)
   ========================================================= */

let isDraining = false;

function enterDrainAndExit(reason: string, err?: unknown): void {
  if (isDraining) return;

  isDraining = true;

  logger.fatal(
    {
      reason,
      err
    },
    "Fatal runtime error (entering drain mode)"
  );

  try {
    const msg =
      `❌ Fatal runtime error: ${String(reason)} ` +
      (err ? ` ${String(err)}` : "") +
      "\n";
    process.stderr.write(msg);
  } catch {
    // ignore
  }

  setTimeout(() => process.exit(1), 2000).unref();
}

process.on("unhandledRejection", (err) => {
  enterDrainAndExit("unhandledRejection", err);
});

process.on("uncaughtException", (err) => {
  enterDrainAndExit("uncaughtException", err);
});

/* =========================================================
   APP

   The drain-blocking middleware inside the app consults the
   getter below, so it always observes the current flag value.
   ========================================================= */

const app = createApp({
  isDev,
  publicApiDisabled,
  isDraining: () => isDraining
});

/* =========================================================
   START SERVER
   ========================================================= */

await connectDatabase();
await startupCheck();

startScheduler();
// Missed-week recovery for the weekly Brief cron. Called always; self-gates on
// SECURELOGIC_BRIEF_CATCHUP_ENABLED (DARK by default → zero DB access, no send).
// Fire-and-forget so it never blocks boot/listen; it swallows its own errors.
void runBriefCatchupIfMissed().catch((err) => {
  logger.error({ event: "brief_catchup_boot_failed", err }, "Brief catch-up failed at boot (non-fatal)");
});
startAccountDeletionReaperEnqueuer();
// TDG E-1: retention sweep enqueuer. Registered always; the tick self-gates on
// SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED (zero DB access while off), so
// this line is inert until the operator enables tenant data governance — and
// even then a sweep deletes nothing until SECURELOGIC_TDG_EFFECTIVE_FROM is set
// and its grace window has elapsed.
startRetentionSweepEnqueuer();
// ECL R3: in-process reassessment worker. Registered always; every tick
// self-gates on SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED (zero DB access while
// off), so this line is inert until the operator enables the ECL.
startApplicabilityReassessmentWorker();
// EAR Phase 3b: connector sync worker. Registered always; every tick
// self-gates on SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED AND
// SECURELOGIC_ASSET_REGISTRY_ENABLED (zero DB access while either is off).
startConnectorSyncWorker();
// ERIP E2a: bidirectional writeback. Registered always; each tick self-gates on
// SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED + SECURELOGIC_ASSET_REGISTRY_ENABLED +
// SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED (the only external-MUTATION path).
startConnectorWritebackWorker();
// ERIP F2: daily risk-history snapshot. Registered always; each tick self-gates
// on SECURELOGIC_RISK_INTELLIGENCE_ENABLED AND SECURELOGIC_ASSET_REGISTRY_ENABLED.
startRiskHistoryWorker();
// Accepted risk is time-boxed: expired acceptances reopen their findings. Self-gates
// on SECURELOGIC_RISK_ACCEPTANCE_ENABLED.
startRiskAcceptanceExpiryWorker();
// Vendor Assurance monitoring: overdue reviews + intelligence-triggered
// reassessment recommendations. Self-gates on SECURELOGIC_VENDOR_ASSURANCE_ENABLED.
startVendorAssuranceMonitoringWorker();
// ERIP E5: daily predictive forecast inference/retraining. Registered always;
// self-gates on SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED + asset-registry flag.
startPredictiveForecastWorker();
// ERIP E6b: scheduled playbook instantiation (creates proposals; still human-
// approved). Registered always; self-gates on SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED.
startOrchestrationPlaybookWorker();
// Webhook retry drain — makes the dispatcher's scheduled retries actually
// fire (they were write-only before this worker). Registered always;
// SECURELOGIC_WEBHOOK_RETRY_DISABLED=true is the ops brake.
startWebhookRetryWorker();
// O-11 export-bundle TTL sweep — deletes expired R2 export bundles and marks
// rows purged (the declared-but-never-implemented 'export_file_purge' half
// of the data-export lifecycle). Registered always;
// SECURELOGIC_EXPORT_PURGE_DISABLED=true is the ops brake.
startExportFilePurgeWorker();

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info(
    {
      port: PORT,
      nodeEnv: process.env.NODE_ENV ?? null,
      isProd,
      debugEnabled,
      publicApiDisabled
    },
    "SecureLogic Engine API started"
  );
});

/* =========================================================
   GRACEFUL SHUTDOWN
   ========================================================= */

const shutdown = async (signal: string) => {
  isDraining = true;
  logger.warn({ signal }, "Shutdown signal received. Draining...");

  server.close(async () => {
    try {
      if (redisReady) {
        try {
          const redis = await ensureRedisConnected();
          if (redis.isOpen) await redis.quit();
        } catch (err) {
          logger.error({ err }, "Redis shutdown failed");
        }
      }
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
