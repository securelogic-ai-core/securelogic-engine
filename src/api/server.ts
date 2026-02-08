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
import { verifyIssueSignature } from "./infra/verifyIssueSignature.js";
import { logger } from "./infra/logger.js";

import { requestId } from "./middleware/requestId.js";
import { requireApiKey } from "./middleware/requireApiKey.js";
import { resolveEntitlement } from "./middleware/resolveEntitlement.js";
import { requestAudit } from "./middleware/requestAudit.js";

import { enforceUsageCap } from "./middleware/enforceUsageCap.js";
import { tierRateLimit } from "./middleware/tierRateLimit.js";

import { requireSubscription } from "./middleware/requireSubscription.js";
import { verifyLemonWebhook } from "./middleware/verifyLemonWebhook.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { requireAdminNetwork } from "./middleware/requireAdminNetwork.js";
import { requireAdminKey } from "./middleware/requireAdminKey.js";
import { adminRateLimit } from "./middleware/adminRateLimit.js";
import { adminAudit } from "./middleware/adminAudit.js";

import adminEntitlementsRouter from "./routes/adminEntitlements.js";

import { isSignedIssue } from "./contracts/signedIssue.schema.js";
import type { SignedIssue } from "./contracts/signedIssue.schema.js";

import {
  getLatestIssueId,
  getIssueArtifact,
  publishIssueArtifact
} from "./infra/issueStore.js";

import { lemonWebhook } from "./webhooks/lemonWebhook.js";

/* =========================================================
   BOOT-TIME GUARDS
   ========================================================= */

validateEnv();
runSelfTest();

/* =========================================================
   APP INIT
   ========================================================= */

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

const isDev = process.env.NODE_ENV === "development";
const isProd = process.env.NODE_ENV === "production";

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
 * - We are deployed behind a proxy (Render / Cloud)
 * - Needed for correct IP + rate limit behavior
 */
app.set("trust proxy", 1);

/* =========================================================
   DRAIN MODE (GRACEFUL SHUTDOWN + FAIL CLOSED)
   ========================================================= */

let isDraining = false;

/**
 * Enterprise fatal error handler.
 * If the process enters an unsafe state, we:
 * - log fatal
 * - enter drain mode
 * - exit after a short timeout
 */
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

  // Ensure fatal is visible even if logging breaks
  console.error("❌ Fatal runtime error:", reason, err);

  setTimeout(() => process.exit(1), 2000).unref();
}

/**
 * Enterprise-grade crash hardening:
 * - NEVER ignore unhandled promise rejections
 * - NEVER ignore uncaught exceptions
 */
process.on("unhandledRejection", (err) => {
  enterDrainAndExit("unhandledRejection", err);
});

process.on("uncaughtException", (err) => {
  enterDrainAndExit("uncaughtException", err);
});

/* =========================================================
   ENTERPRISE REQUEST TIMEOUT (FAIL CLOSED)
   ========================================================= */

/**
 * Enterprise rule:
 * - A request must never hang forever
 * - This prevents slowloris + stuck handlers
 */
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
   MAX HEADER SIZE GUARD (ENTERPRISE)
   ========================================================= */

/**
 * Enterprise rule:
 * - Kill header abuse before it hits auth
 * - Prevent oversized Authorization / API key headers
 *
 * NOTE:
 * Node has server-level limits, but we enforce here too.
 */
const MAX_HEADER_BYTES = 8 * 1024;

app.use((req, res, next) => {
  try {
    let total = 0;

    for (const [k, v] of Object.entries(req.headers)) {
      total += Buffer.byteLength(k, "utf8");

      if (Array.isArray(v)) {
        for (const part of v) total += Buffer.byteLength(part, "utf8");
      } else if (typeof v === "string") {
        total += Buffer.byteLength(v, "utf8");
      }
    }

    if (total > MAX_HEADER_BYTES) {
      logger.warn(
        {
          event: "blocked_oversized_headers",
          method: req.method,
          path: req.originalUrl,
          headerBytes: total,
          maxAllowed: MAX_HEADER_BYTES
        },
        "Blocked request with oversized headers"
      );

      res.status(431).json({ error: "request_header_fields_too_large" });
      return;
    }

    next();
  } catch (err) {
    logger.error(
      {
        event: "header_size_guard_failed",
        err
      },
      "Header size guard failed"
    );

    res.status(400).json({ error: "bad_request" });
  }
});

/* =========================================================
   ENTERPRISE SECURITY BASELINE (PROD SAFE)
   ========================================================= */

/**
 * 1) Standard hardening headers
 */
app.use(
  helmet({
    contentSecurityPolicy: false, // API-only service (no HTML)
    crossOriginEmbedderPolicy: false
  })
);

/**
 * 1b) Explicit API security headers (enterprise expectations)
 * Helmet covers many of these, but we enforce them explicitly.
 */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=()"
  );
  next();
});

/**
 * 2) Prevent HTTP parameter pollution
 */
app.use(hpp());

/**
 * 3) Strict CORS
 *
 * Enterprise rule:
 * - Default deny (no browser access)
 * - This is an API service
 */
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
      "X-Request-Id"
    ],
    maxAge: 86400
  })
);

/**
 * 4) Global abuse throttling (layer 1)
 */
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

/**
 * 5) Enterprise: disable caching for API responses
 * (especially auth + entitlements + issues)
 */
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

/* =========================================================
   STRICT CONTENT-TYPE ENFORCEMENT (ENTERPRISE)
   ========================================================= */

/**
 * Enterprise rule:
 * - Reject garbage Content-Type headers
 * - Only accept JSON for POST/PUT/PATCH unless explicitly raw webhook
 */
app.use((req, res, next) => {
  const method = req.method.toUpperCase();

  const isBodyMethod =
    method === "POST" || method === "PUT" || method === "PATCH";

  // Webhook uses raw body parser, must not be blocked here
  if (req.originalUrl.startsWith("/webhooks/lemon")) {
    next();
    return;
  }

  if (!isBodyMethod) {
    next();
    return;
  }

  const ct = req.headers["content-type"] ?? "";

  // allow empty (some clients send no body)
  if (typeof ct !== "string" || ct.trim().length === 0) {
    next();
    return;
  }

  const normalized = ct.toLowerCase();

  // only accept json payloads
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

/**
 * IMPORTANT:
 * This route MUST use raw body, otherwise HMAC validation fails.
 * We attach rawBody for verifyLemonWebhook middleware.
 */
app.post(
  "/webhooks/lemon",
  bodyParser.raw({ type: "application/json", limit: "256kb" }),
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

/**
 * Enterprise rule:
 * - strict JSON limit
 * - prevent JSON bombs
 */
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

/* =========================================================
   HEALTH CHECK (NO AUTH)
   ========================================================= */

app.get("/health", async (_req: Request, res: Response) => {
  if (!redisReady) {
    res.status(200).json({
      status: "degraded",
      dependency: "redis",
      redisConfigured: false,
      redisConnected: false
    });
    return;
  }

  try {
    const redis = await ensureRedisConnected();
    const pong = await redis.ping();

    res.status(200).json({
      status: "ok",
      redisConfigured: true,
      redisConnected: true,
      ping: pong
    });
  } catch {
    res.status(200).json({
      status: "degraded",
      dependency: "redis",
      redisConfigured: true,
      redisConnected: false
    });
  }
});

/* =========================================================
   VERSION CHECK (DEPLOY VERIFICATION)
   ========================================================= */

app.get("/version", (_req: Request, res: Response) => {
  res.status(200).json({
    commit: process.env.RENDER_GIT_COMMIT ?? "unknown",
    service: "securelogic-engine",
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   DEBUG ROUTES (DEV ONLY, EXPLICIT OPT-IN REQUIRED)
   ========================================================= */

if (debugEnabled) {
  app.get("/debug/node_env", (_req: Request, res: Response) => {
    res.status(200).json({
      nodeEnv: process.env.NODE_ENV ?? null,
      debugEnabled: true
    });
  });

  app.get("/debug/headers", (req: Request, res: Response) => {
    res.status(200).json({
      headers: req.headers,
      authorization: req.get("authorization") ?? null,
      xSecurelogicKey: req.get("x-securelogic-key") ?? null,
      xApiKey: req.get("x-api-key") ?? null
    });
  });

  app.get("/debug/issues_key", (req: Request, res: Response) => {
    res.status(200).json({
      headers: req.headers,
      authorization: req.get("authorization") ?? null,
      xSecurelogicKey: req.get("x-securelogic-key") ?? null,
      xApiKey: req.get("x-api-key") ?? null,
      apiKeyOnReq: (req as any).apiKey ?? null,
      entitlementOnReq: (req as any).entitlement ?? null,
      activeSubscriptionOnReq: (req as any).activeSubscription ?? null
    });
  });
}

/* =========================================================
   🔒 ADMIN ROUTES (ENTERPRISE)
   ========================================================= */

app.use("/admin", requireAdminNetwork);
app.use("/admin", requireAdminKey);
app.use("/admin", adminRateLimit);
app.use("/admin", adminAudit);

app.use(adminEntitlementsRouter);

/* =========================================================
   ADMIN DEBUG ROUTES (DEV ONLY, EXPLICIT OPT-IN REQUIRED)
   ========================================================= */

if (debugEnabled) {
  app.get(
    "/admin/debug/redis/issue/latest",
    async (_req: Request, res: Response) => {
      try {
        if (!redisReady) {
          res.status(503).json({ error: "redis_not_configured" });
          return;
        }

        const redis = await ensureRedisConnected();
        const latest = await redis.get("issues:latest");

        res.status(200).json({
          latest,
          key: "issues:latest"
        });
      } catch (err) {
        logger.error(
          {
            event: "admin_debug_latest_issue_failed",
            err
          },
          "/admin/debug/redis/issue/latest failed"
        );

        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  app.get(
    "/admin/debug/redis/issue/:id",
    async (req: Request, res: Response) => {
      try {
        if (!redisReady) {
          res.status(503).json({ error: "redis_not_configured" });
          return;
        }

        const idNum = Number(req.params.id);

        if (!Number.isFinite(idNum) || idNum <= 0) {
          res.status(400).json({ error: "invalid_issue_id" });
          return;
        }

        const redis = await ensureRedisConnected();

        const latest = await redis.get("issues:latest");
        const raw = await redis.get(`issues:artifact:${idNum}`);

        res.status(200).json({
          latest,
          key: `issues:artifact:${idNum}`,
          raw
        });
      } catch (err) {
        logger.error(
          {
            event: "admin_debug_issue_lookup_failed",
            err
          },
          "/admin/debug/redis/issue/:id failed"
        );

        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  app.get("/admin/debug/issues_key", (req: Request, res: Response) => {
    res.status(200).json({
      headers: req.headers,
      authorization: req.get("authorization") ?? null,
      xSecurelogicKey: req.get("x-securelogic-key") ?? null,
      xApiKey: req.get("x-api-key") ?? null,
      apiKeyOnReq: (req as any).apiKey ?? null,
      entitlementOnReq: (req as any).entitlement ?? null,
      activeSubscriptionOnReq: (req as any).activeSubscription ?? null
    });
  });
}

/* =========================================================
   ADMIN ISSUE PUBLISH
   ========================================================= */

app.post("/admin/issues/publish", async (req: Request, res: Response) => {
  try {
    if (!redisReady) {
      res.status(503).json({ error: "redis_not_configured" });
      return;
    }

    const parsed = req.body as unknown;

    if (!isSignedIssue(parsed)) {
      res.status(400).json({ error: "invalid_signed_issue_artifact" });
      return;
    }

    const artifact = parsed as SignedIssue;

    if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
      res.status(400).json({ error: "issue_signature_invalid" });
      return;
    }

    const issueNumber = artifact.issue.issueNumber;

    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      res.status(400).json({ error: "invalid_issue_number" });
      return;
    }

    await publishIssueArtifact(issueNumber, JSON.stringify(artifact));

    res.status(200).json({
      ok: true,
      published: issueNumber
    });
  } catch (err) {
    logger.error(
      {
        event: "admin_issue_publish_failed",
        err
      },
      "/admin/issues/publish failed"
    );

    res.status(500).json({ error: "internal_error" });
  }
});

/* =========================================================
   DEBUG: ISSUE AUTH HEADER CHECK (DEV ONLY, EXPLICIT OPT-IN)
   ========================================================= */

if (debugEnabled) {
  app.get("/issues/_debug_key", (req: Request, res: Response) => {
    res.status(200).json({
      headers: req.headers,
      authorization: req.get("authorization") ?? null,
      xSecurelogicKey: req.get("x-securelogic-key") ?? null,
      xApiKey: req.get("x-api-key") ?? null,
      apiKeyOnReq: (req as any).apiKey ?? null,
      entitlementOnReq: (req as any).entitlement ?? null,
      activeSubscriptionOnReq: (req as any).activeSubscription ?? null
    });
  });
}

/* =========================================================
   🔒 AUTH CHAIN (ISSUES)
   ========================================================= */

app.use("/issues", requireApiKey);
app.use("/issues", resolveEntitlement);
app.use("/issues", tierRateLimit);
app.use("/issues", enforceUsageCap());
app.use("/issues", requestAudit);

/* =========================================================
   ROUTES
   ========================================================= */

/**
 * Kill switch: disable public API during incident response.
 * Admin routes remain available.
 */
app.use("/issues", (_req, res, next) => {
  if (!publicApiDisabled) {
    next();
    return;
  }

  res.status(503).json({
    error: "service_unavailable",
    reason: "public_api_disabled"
  });
});

app.get("/issues/latest", async (_req: Request, res: Response) => {
  try {
    const latestId = await getLatestIssueId();

    if (!latestId) {
      res.status(404).json({ error: "no_issues_published" });
      return;
    }

    const raw = await getIssueArtifact(latestId);

    if (!raw) {
      res.status(404).json({ error: "no_issues_published" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "issue_artifact_corrupted" });
      return;
    }

    if (!isSignedIssue(parsed)) {
      res.status(500).json({ error: "issue_artifact_invalid" });
      return;
    }

    const artifact = parsed as SignedIssue;

    if (!isDev) {
      if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
        res.status(500).json({ error: "issue_signature_verification_failed" });
        return;
      }
    }

    res.status(200).json(artifact.issue);
  } catch (err) {
    logger.error(
      {
        event: "issues_latest_failed",
        err
      },
      "/issues/latest failed"
    );

    res.status(500).json({ error: "internal_error" });
  }
});

app.get(
  "/issues/:id",
  requireSubscription,
  async (req: Request, res: Response) => {
    try {
      const idNum = Number(req.params.id);

      if (!Number.isFinite(idNum) || idNum <= 0) {
        res.status(400).json({ error: "invalid_issue_id" });
        return;
      }

      const raw = await getIssueArtifact(idNum);

      if (!raw) {
        res.status(404).json({ error: "issue_not_found" });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.status(500).json({ error: "issue_artifact_corrupted" });
        return;
      }

      if (!isSignedIssue(parsed)) {
        res.status(500).json({ error: "issue_artifact_invalid" });
        return;
      }

      const artifact = parsed as SignedIssue;

      if (!isDev) {
        if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
          res.status(500).json({
            error: "issue_signature_verification_failed"
          });
          return;
        }
      }

      res.status(200).json(artifact.issue);
    } catch (err) {
      logger.error(
        {
          event: "issues_get_by_id_failed",
          err
        },
        "/issues/:id failed"
      );

      res.status(500).json({ error: "internal_error" });
    }
  }
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