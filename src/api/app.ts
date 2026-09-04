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
import { buildAllowedOrigins, isAllowedOrigin } from "./lib/corsOrigins.js";
import rateLimit from "express-rate-limit";
import { rateLimitKeyGenerator } from "./infra/clientIp.js";
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

import { Sentry } from "./lib/sentry.js";
import { enforceJsonContentType } from "./lib/contentTypeAllowlist.js";

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

// `req.rawBody` (Express.Request and http.IncomingMessage) is declared in
// src/api/types/express-raw-body.d.ts. It was moved out of this file on
// 2026-08-16: declaring it here made the type available only to builds that
// compile app.ts, so any tsconfig that reached a consumer without it failed
// with TS2339. This file still owns the ASSIGNMENT of both fields below.

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

// Ask's tool path is the one surface this default cannot hold. A turn is a
// multi-round loop (up to MAX_ITERATIONS model calls, each followed by tool
// execution) and then a separate provenance pass. Measured on staging
// 2026-08-14 for one ordinary question: ~17s orchestration + ~23s provenance =
// 45s wall clock. Under the 30s default:
//
//   - POST /api/ask (JSON) 504'd on EVERY tool-path turn. Nothing is written to
//     the socket while the loop runs, so the idle timer never resets and the
//     30s behaves as a hard total-duration cap.
//   - POST /api/ask/stream survived only incidentally, because each SSE write
//     resets that timer. The provenance pass writes nothing for its whole
//     duration — a measured 29s silent gap, i.e. one second inside the limit.
//     A marginally slower pass truncates the stream after the last delta and
//     before `final`, which the client reads as a silently incomplete answer.
//
// Both routes therefore get the same longer budget. This is a CEILING, not a
// comfort margin: the edge proxy in front of the service (Cloudflare) aborts an
// origin request around 100s and answers with its own HTML 524, which no client
// here can parse. Staying below that keeps a timeout a clean JSON 504.
const ASK_REQUEST_TIMEOUT_MS = 90_000;

// Exact match, deliberately not a prefix. The other /api/ask/* routes —
// conversation reads and the actions confirm/decline pair — do no model work
// and must keep the strict default.
const EXTENDED_TIMEOUT_PATHS: ReadonlySet<string> = new Set([
  "/api/ask",
  "/api/ask/stream"
]);

/**
 * The request-timeout budget for a routed path. Exported as a pure function so
 * the policy is assertable directly — proving it by driving a real socket to
 * expiry would mean a 90-second test.
 *
 * `path` is req.path (no query string).
 */
export function resolveRequestTimeoutMs(path: string): number {
  const routedPath = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return EXTENDED_TIMEOUT_PATHS.has(routedPath) ? ASK_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

// Browser origins allowed to call the engine directly: the exact production
// origins plus this deployment's own app origin (from APP_BASE_URL) — no
// wildcard. See lib/corsOrigins.ts for why the second half exists.
const ALLOWED_ORIGINS = buildAllowedOrigins();

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
    // req.path excludes the query string, and the resolver normalizes a
    // trailing slash so "/api/ask/" cannot reach the handler while missing its
    // budget here.
    const timeoutMs = resolveRequestTimeoutMs(req.path);

    // Stamp WHEN this request dies, not just how long it had. A handler doing
    // multi-second model work needs to know how much budget is left before
    // starting the next expensive step — Ask's provenance pass declines to run
    // rather than overrun it and turn a written answer into a 504. Set here, in
    // the same place the timeout is armed, so the two can never disagree.
    (req as unknown as { deadlineAt?: number }).deadlineAt = Date.now() + timeoutMs;

    res.setTimeout(timeoutMs, () => {
      logger.warn(
        {
          event: "request_timeout",
          method: req.method,
          path: req.originalUrl,
          timeoutMs
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
        callback(null, isAllowedOrigin(origin, { allowed: ALLOWED_ORIGINS, isDev }));
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
    keyGenerator: rateLimitKeyGenerator,
    standardHeaders: true,
    legacyHeaders: false
  });

  const globalSlowdown = slowDown({
    windowMs: 60_000,
    keyGenerator: rateLimitKeyGenerator,
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

  // Routes that legitimately receive non-JSON bodies (raw webhooks, multipart
  // uploads incl. /api/ask/transcribe audio, SAML form posts) are exempt — see
  // contentTypeAllowlist.ts (pure + tested so the exempt list can't regress).
  app.use(enforceJsonContentType);

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
    keyGenerator: rateLimitKeyGenerator,
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
     SENTRY ERROR CAPTURE (BEFORE THE RESPONDING HANDLER)

     Captures errors propagated via next(err) and forwards them to the
     engine's own errorHandler, which still owns the response. This is a
     no-op capture when Sentry is not initialized (no DSN). In @sentry/node
     v10 there is no separate requestHandler middleware — request isolation is
     automatic — so only the error handler is registered here.
     ========================================================= */

  Sentry.setupExpressErrorHandler(app);

  /* =========================================================
     ERROR HANDLER (LAST)
     ========================================================= */

  app.use(errorHandler);

  return app;
}
