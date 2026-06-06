import "dotenv/config";

import { initSentry } from "./lib/sentry.js";

import { validateEnv } from "./startup/validateEnv.js";
import { runSelfTest } from "./startup/selfTest.js";
import { connectDatabase } from "./startup/connectDatabase.js";
import { startupCheck } from "./startup/startupCheck.js";

import { ensureRedisConnected, redisReady } from "./infra/redis.js";
import { logger } from "./infra/logger.js";

import { startScheduler } from "./lib/schedulerRunner.js";
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
