import "dotenv/config";

import express, { type Request, type Response } from "express";
import bodyParser from "body-parser";

import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import hpp from "hpp";

import { validateEnv } from "./startup/validateEnv.js";
import { runSelfTest } from "./startup/selfTest.js";

import { ensureRedisConnected, redisReady } from "./infra/redis.js";
import { httpLogger } from "./infra/httpLogger.js";
import { logger } from "./infra/logger.js";

import { rejectUnexpectedOptions } from "./middleware/rejectUnexpectedOptions.js";
import { rejectOversizedHeaders } from "./middleware/rejectOversizedHeaders.js";
import { rejectOversizedUrl } from "./middleware/rejectOversizedUrl.js";
import { rejectInvalidMethodOverride } from "./middleware/rejectInvalidMethodOverride.js";
import { rejectChunkedBodies } from "./middleware/rejectChunkedBodies.js";
import { rejectOversizedBody } from "./middleware/rejectOversizedBody.js";
import { rejectInvalidJson } from "./middleware/rejectInvalidJson.js";

import { requestId } from "./middleware/requestId.js";

import { verifyLemonWebhook } from "./middleware/verifyLemonWebhook.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { lemonWebhook } from "./webhooks/lemonWebhook.js";
import { buildRoutes } from "./routes/index.js";

/* =========================================================
   BOOT-TIME GUARDS
   ========================================================= */

validateEnv();
runSelfTest();

/* =========================================================
   APP INIT
   ========================================================= */

const app = express();

/**
 * Enterprise default:
 * Keep PORT stable and explicit.
 */
const PORT = Number(process.env.PORT ?? 4000);

const nodeEnv = (process.env.NODE_ENV ?? "").trim();
const isDev = nodeEnv === "development";
const isProd = nodeEnv === "production";

/**
 * Enterprise:
 * Debug routes must NEVER be controlled by NODE_ENV alone.
 * They require an explicit opt-in flag.
 */
const debugEnabled =
  isDev && (process.env.ENABLE_DEBUG_ROUTES ?? "").trim() === "true";

/**
 * Enterprise:
 * Emergency kill switch.
 * When true:
 * - Public /issues API is disabled
 * - Admin endpoints remain available (for recovery)
 */
const publicApiDisabled =
  (process.env.SECURELOGIC_DISABLE_PUBLIC_API ?? "").trim().toLowerCase() ===
  "true";

/**
 * Enterprise:
 * We are deployed behind a proxy (Render / Cloudflare).
 */
app.set("trust proxy", 1);

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
   ENTERPRISE REQUEST TIMEOUT (FAIL CLOSED)
   ========================================================= */

const REQUEST_TIMEOUT_MS = 30_000;

app.use((req, res, next) => {
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    logger.warn(
      {
        event: "request_timeout",
        method: req.method,
        path: req.originalUrl
      },
      "Request timed out"
    );

    if (!res.headersSent) {
      res.status(504).json({ error: "request_timeout" });
    }
  });

  next();
});

/* =========================================================
   ENTERPRISE SECURITY BASELINE (PROD SAFE)
   ========================================================= */

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=()"
  );
  next();
});

app.use(hpp());

/**
 * Block unexpected OPTIONS requests.
 */
app.use(rejectUnexpectedOptions);

/**
 * Block HTTP method override attacks early.
 */
app.use(rejectInvalidMethodOverride);

/**
 * Block absurd request headers early.
 */
app.use(rejectOversizedHeaders);

/**
 * Block absurd URL length early.
 */
app.use(rejectOversizedUrl);

/**
 * Enterprise: Fail closed on chunked request bodies.
 */
app.use(rejectChunkedBodies);

/**
 * Block absurd request body size early (before JSON parse).
 */
app.use(rejectOversizedBody);

app.use(
  cors({
    origin: false,
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Admin-Key",
      "X-Api-Key",
      "X-Securelogic-Key",
      "X-Request-Id",
      "X-Signature",
      "X-Webhook-Signature"
    ],
    maxAge: 86400
  })
);

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
});

const globalSlowdown = slowDown({
  windowMs: 60_000,
  delayAfter: 100,
  delayMs: () => 250
});

app.use(globalSlowdown);
app.use(globalLimiter);

app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

/* =========================================================
   STRICT CONTENT-TYPE ENFORCEMENT (ENTERPRISE)
   ========================================================= */

app.use((req, res, next) => {
  const method = req.method.toUpperCase();

  const isBodyMethod =
    method === "POST" || method === "PUT" || method === "PATCH";

  /**
   * Webhooks MUST be excluded because they are raw-body verified.
   */
  if (req.originalUrl.startsWith("/webhooks/lemon")) {
    next();
    return;
  }

  if (!isBodyMethod) {
    next();
    return;
  }

  const ct = req.headers["content-type"] ?? "";

  if (typeof ct !== "string" || ct.trim().length === 0) {
    next();
    return;
  }

  const normalized = ct.toLowerCase();

  if (!normalized.startsWith("application/json")) {
    logger.warn(
      {
        event: "blocked_invalid_content_type",
        method: req.method,
        route: req.originalUrl,
        contentType: ct
      },
      "Blocked request with invalid Content-Type"
    );

    res.status(415).json({ error: "unsupported_media_type" });
    return;
  }

  next();
});

/* =========================================================
   REQUEST CORRELATION
   ========================================================= */

app.use(requestId);

/* =========================================================
   HTTP REQUEST LOGGING
   ========================================================= */

app.use(httpLogger);

/* =========================================================
   DRAIN MODE (REQUEST BLOCKING)
   ========================================================= */

app.use((_req, res, next) => {
  if (isDraining) {
    res.status(503).json({ error: "server_shutting_down" });
    return;
  }
  next();
});

/* =========================================================
   WEBHOOKS (RAW BODY FIRST)
   ========================================================= */

app.post(
  "/webhooks/lemon",
  bodyParser.raw({
    type: "application/json",
    limit: "256kb"
  }),
  (req, _res, next) => {
    (req as any).rawBody = req.body;
    next();
  },
  verifyLemonWebhook,
  lemonWebhook
);

/* =========================================================
   BODY PARSER (MUST BE AFTER RAW WEBHOOKS)
   ========================================================= */

app.use(express.json({ limit: "256kb" }));

/**
 * MUST be immediately after express.json()
 * so invalid JSON becomes a clean 400.
 */
app.use(rejectInvalidJson);

app.use(express.urlencoded({ extended: false, limit: "256kb" }));

/* =========================================================
   ROUTES (ENTERPRISE)
   ========================================================= */

/**
 * All routing is centralized in routes/index.ts.
 * server.ts should never mount /admin or /issues directly.
 */
app.use(
  buildRoutes({
    isDev,
    publicApiDisabled
  })
);

/* =========================================================
   404 HANDLER (ENTERPRISE)
   ========================================================= */

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "not_found",
    path: req.originalUrl
  });
});

/* =========================================================
   ERROR HANDLER (LAST)
   ========================================================= */

app.use(errorHandler);

/* =========================================================
   START SERVER
   ========================================================= */

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info(
    {
      port: PORT,
      nodeEnv: process.env.NODE_ENV ?? null,
      isProd,
      debugEnabled,
      publicApiDisabled
    },
    "SecureLogic Issue API started"
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

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);