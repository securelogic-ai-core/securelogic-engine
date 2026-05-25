/**
 * app.ts — Express application factory.
 *
 * createApp() builds the fully-wired SecureLogic Engine API application:
 * the complete middleware chain, the Stripe webhook mount, the route tree,
 * and the 404 + error handlers.
 *
 * createApp() deliberately does NOT: run boot-time guards (validateEnv /
 * runSelfTest), connect to the database, run the startup check, start the
 * scheduler, or bind a port. Those are entrypoint responsibilities and
 * live in server.ts.
 *
 * The split exists so the exact production application can be constructed
 * and driven in tests — without booting a real server — for example by the
 * cross-org isolation harness (audit finding E1-G1). server.ts is the only
 * caller in production; nothing in the request path differs between the
 * server.ts (listen) and test (createApp) paths, because the request path
 * IS this function.
 */

import path from "path";
import { fileURLToPath } from "url";

import cookieParser from "cookie-parser";

import express, { type Request, type Response } from "express";
import bodyParser from "body-parser";

import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import hpp from "hpp";

import { httpLogger } from "./infra/httpLogger.js";
import { logger } from "./infra/logger.js";

import { securityHeaders } from "./middleware/securityHeaders.js";
import { rejectUnexpectedOptions } from "./middleware/rejectUnexpectedOptions.js";
import { rejectOversizedHeaders } from "./middleware/rejectOversizedHeaders.js";
import { rejectOversizedUrl } from "./middleware/rejectOversizedUrl.js";
import { rejectInvalidMethodOverride } from "./middleware/rejectInvalidMethodOverride.js";
import { rejectChunkedBodies } from "./middleware/rejectChunkedBodies.js";
import { rejectOversizedBody } from "./middleware/rejectOversizedBody.js";
import { rejectInvalidJson } from "./middleware/rejectInvalidJson.js";

import { requestId } from "./middleware/requestId.js";
import { requestAudit } from "./middleware/requestAudit.js";

import { errorHandler } from "./middleware/errorHandler.js";

// Lemon Squeezy is dormant: route /webhooks/lemon is unmounted (returns 404).
// Re-enable by re-adding these imports and the app.post block in the WEBHOOKS
// section. See memory: project_lemon_webhook_body_buffer_bug.md — also fix the
// req.body Buffer-vs-parsed-object bug before reactivating.
// import { verifyLemonWebhook } from "./middleware/verifyLemonWebhook.js";
// import { lemonWebhook } from "./webhooks/lemonWebhook.js";
import { stripeWebhook } from "./webhooks/stripeWebhook.js";
import { buildRoutes } from "./routes/index.js";

/* =========================================================
   TYPE AUGMENTATION
   ========================================================= */

declare global {
  namespace Express {
    interface Request {
      rawBody?: string | Buffer;
    }
  }
}

// The express.json() verify callback receives http.IncomingMessage, not Express.Request
declare module "http" {
  interface IncomingMessage {
    rawBody?: string | Buffer;
  }
}

/* =========================================================
   MODULE-LEVEL PATH HELPERS
   ========================================================= */

// Resolved at module load. In dev (tsx): points to src/api/.
// In production (node dist/api/app.js): points to dist/api/.
// Used by both the dev dashboard and the static asset handler.
// app.ts sits in the same directory as server.ts, so this resolves
// identically to the value server.ts computed before the createApp split.
const __serverDir = path.dirname(fileURLToPath(import.meta.url));

/* =========================================================
   ENTERPRISE REQUEST TIMEOUT (FAIL CLOSED)
   ========================================================= */

const REQUEST_TIMEOUT_MS = 30_000;

// Production origins: exact-match allowlist — no wildcard.
// Dev origins: github.dev previews (*.app.github.dev) plus localhost variants.
const PROD_ORIGINS = new Set([
  "https://www.securelogicai.com",
  "https://securelogicai.com",
  "https://app.securelogicai.com"
]);

const DEV_ORIGIN_RE =
  /^https:\/\/[a-z0-9-]+-[a-z0-9]+-[a-z0-9]+\.app\.github\.dev$|^https?:\/\/localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$/;

/* =========================================================
   APP FACTORY
   ========================================================= */

export interface CreateAppOptions {
  /** development runtime — gates the dev dashboard and dev CORS origins. */
  isDev: boolean;
  /** disables the public API surface (forwarded to buildRoutes). */
  publicApiDisabled: boolean;
  /**
   * Returns true when the process is draining (graceful shutdown or a fatal
   * runtime error). The drain-blocking middleware consults this per request
   * and fails closed with 503. The drain flag is owned by the entrypoint
   * (server.ts); this defaults to a never-draining getter so tests and other
   * non-server callers need not supply it.
   */
  isDraining?: () => boolean;
}

/**
 * Build the fully-wired Express application. Pure construction — no I/O,
 * no port binding. See the file header for what is intentionally excluded.
 */
export function createApp(opts: CreateAppOptions): express.Express {
  const { isDev, publicApiDisabled } = opts;
  const isDraining = opts.isDraining ?? (() => false);

  const app = express();

  app.set("trust proxy", 1);

  /* =========================================================
     ENTERPRISE REQUEST TIMEOUT (FAIL CLOSED)
     ========================================================= */

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

  // Consolidated security headers (replaces individual helmet directives and
  // the prior inline header block). securityHeaders must run first so every
  // response — including 4xx/5xx from later middleware — carries the full set.
  app.use(securityHeaders);

  app.use(
    helmet({
      // CSP, HSTS, X-Frame-Options, and X-XSS-Protection are handled by
      // securityHeaders above; disable duplicates in helmet to avoid conflicts.
      contentSecurityPolicy: false,
      hsts: false,
      frameguard: false,
      xssFilter: false,
      crossOriginEmbedderPolicy: false
    })
  );

  app.use(hpp());

  app.use(rejectUnexpectedOptions);
  app.use(rejectInvalidMethodOverride);
  app.use(rejectOversizedHeaders);
  app.use(rejectOversizedUrl);
  app.use(rejectChunkedBodies);
  app.use(rejectOversizedBody);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin / non-browser requests (no Origin header) — allow.
        if (!origin) {
          callback(null, true);
          return;
        }

        if (PROD_ORIGINS.has(origin)) {
          callback(null, true);
          return;
        }

        if (isDev && DEV_ORIGIN_RE.test(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: false,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
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

    if (
      req.originalUrl.startsWith("/webhooks/lemon") ||
      req.originalUrl.startsWith("/webhooks/email/resend") ||
      req.originalUrl.startsWith("/api/vendor-assessments/analyze-document") ||
      /^\/api\/vendor-assurance\/documents(\?|$)/.test(req.originalUrl) ||
      /^\/api\/sso\/[^/]+\/acs/.test(req.originalUrl)
    ) {
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
  app.use(requestAudit);

  /* =========================================================
     HTTP REQUEST LOGGING
     ========================================================= */

  app.use(httpLogger);

  /* =========================================================
     DRAIN MODE (REQUEST BLOCKING)
     ========================================================= */

  app.use((_req, res, next) => {
    if (isDraining()) {
      res.status(503).json({ error: "server_shutting_down" });
      return;
    }
    next();
  });

  /* =========================================================
     WEBHOOKS (RAW BODY FIRST)
     ========================================================= */

  // /webhooks/lemon is intentionally unmounted — Lemon Squeezy is dormant and
  // the handler had a pre-existing req.body-as-Buffer bug that silently 200ed
  // every event as `ignored`. Reactivation checklist:
  //   1. Fix the body-parse bug (see project_lemon_webhook_body_buffer_bug.md).
  //   2. Re-add the imports at the top of this file.
  //   3. Restore the app.post("/webhooks/lemon", ...) block here with
  //      bodyParser.raw + rawBody setter + verifyLemonWebhook + lemonWebhook.
  //   4. Re-verify the strict Content-Type allowlist exception above still
  //      matches (it is preserved so re-enablement is a single-file change).

  // Stripe webhook rate limiter — 200 req/min per IP.
  // High enough for legitimate Stripe burst delivery (retries, backfill) but
  // blocks abuse. Scoped only to this endpoint; does not affect other webhooks.
  const stripeWebhookLimiter = rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post(
    "/webhooks/stripe",
    stripeWebhookLimiter,
    bodyParser.raw({
      type: "application/json",
      limit: "256kb"
    }),
    (req, _res, next) => {
      req.rawBody = req.body;
      next();
    },
    stripeWebhook
  );

  /* =========================================================
     BODY PARSER (MUST BE AFTER RAW WEBHOOKS)
     ========================================================= */

  app.use(
    express.json({
      limit: "256kb",
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      }
    })
  );

  app.use(rejectInvalidJson);
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));

  /* =========================================================
     COOKIE PARSER
     ========================================================= */

  app.use(cookieParser());

  /* =========================================================
     DEV DASHBOARD (local operator UI — dev only)
     ========================================================= */

  if (isDev) {
    const projectRoot = path.resolve(__serverDir, "../..");

    const dashboardCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "font-src 'self' https://unpkg.com",
      "img-src 'self' data:"
    ].join("; ");

    app.get("/dashboard", (_req, res) => {
      res.setHeader("Content-Security-Policy", dashboardCsp);
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.sendFile(path.join(projectRoot, "dashboard.html"));
    });

    app.get("/dashboard.jsx", (_req, res) => {
      res.setHeader("Content-Security-Policy", dashboardCsp);
      res.setHeader("Content-Type", "application/javascript");
      res.sendFile(path.join(projectRoot, "dashboard.jsx"));
    });
  }

  /* =========================================================
     STATIC ASSETS  (/assets/*)
     ========================================================= */

  // Serves src/api/public/assets/ in dev (tsx) and dist/api/public/assets/ in
  // production (copied there by the build script).
  // setHeaders overrides the global Cache-Control: no-store so that the logo
  // and other static files are properly cached by email clients and browsers.
  app.use(
    "/assets",
    express.static(path.join(__serverDir, "public", "assets"), {
      maxAge: "7d",
      immutable: true,
      setHeaders(res) {
        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      }
    })
  );

  /* =========================================================
     ROUTES (ENTERPRISE)
     ========================================================= */

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

  return app;
}
