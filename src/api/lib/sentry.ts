/**
 * Sentry error-tracking initialization for the SecureLogic Engine (Express).
 *
 * Additive to the existing pino structured logger — Sentry coexists with the
 * structured logs, it does NOT replace them. The integration is inert (a
 * no-op, with one info-level log line) when SENTRY_DSN_ENGINE is unset, so the
 * service never throws or crashes for lack of a DSN.
 *
 * NOTE on init ordering (ESM): server.ts is an ES module, so top-level
 * `import` statements are hoisted and evaluated before initSentry() is called.
 * By the time init runs, `http`/`express` have already been imported. Sentry's
 * automatic *incoming-HTTP tracing* instrumentation patches `http` at require
 * time, so it is not fully applied here. Error capture — the Express error
 * handler (setupExpressErrorHandler) and explicit captureException() calls —
 * is unaffected and works regardless of import order. Full auto-instrumentation
 * would require a dedicated `--import ./instrument.mjs` preload wired into the
 * start script; that is a deliberate follow-up (see docs/sentry-setup.md), not
 * part of this PR.
 */

import * as Sentry from "@sentry/node";

import { logger } from "../infra/logger.js";

/* =========================================================
   STATE
   ========================================================= */

// `enabled` flips true only after a real Sentry.init() with a DSN.
// `attempted` dedupes the "not configured" log + makes init idempotent.
let enabled = false;
let attempted = false;

/* =========================================================
   SCRUBBING
   ========================================================= */

// Field names (normalized: lowercased, separators removed) whose VALUES must
// never reach Sentry, no matter how deeply nested they appear in an event.
const SENSITIVE_FIELD_NAMES = new Set([
  "password",
  "token",
  "apikey",
  "sessiontoken",
  "mfacode",
  "refreshtoken"
]);

// Request header names (lowercased) stripped wholesale from captured events.
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-api-key"
]);

const REDACTED = "[Filtered]";
const MAX_SCRUB_DEPTH = 8;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Recursively redact the value of any property whose name matches a sensitive
 * field name. Mutates in place; guards against cycles and runaway depth.
 */
function deepScrub(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): void {
  if (depth > MAX_SCRUB_DEPTH) return;
  if (!value || typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) deepScrub(item, seen, depth + 1);
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_FIELD_NAMES.has(normalizeKey(key))) {
      obj[key] = REDACTED;
      continue;
    }
    deepScrub(obj[key], seen, depth + 1);
  }
}

/**
 * beforeSend hook: strip request body + sensitive headers, then deep-scrub any
 * nested secret-named fields from the whole event. Exported for unit testing.
 *
 * Typed loosely (`any`) because the @sentry/node Event/EventHint shapes differ
 * across SDK majors; this hook only touches well-known, stable fields.
 */
export function scrubEvent<T extends Record<string, any>>(event: T): T {
  if (!event || typeof event !== "object") return event;

  const request = event.request as
    | { data?: unknown; headers?: Record<string, unknown>; cookies?: unknown }
    | undefined;

  if (request && typeof request === "object") {
    // req.body — never forward captured request payloads.
    if ("data" in request) delete request.data;
    // Parsed cookies, if Sentry attached them.
    if ("cookies" in request) delete request.cookies;

    if (request.headers && typeof request.headers === "object") {
      for (const headerName of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.has(headerName.toLowerCase())) {
          delete request.headers[headerName];
        }
      }
    }
  }

  // Catch-all: redact secret-named fields anywhere (extra, contexts, breadcrumb
  // data, nested exception mechanism data, etc.).
  deepScrub(event, new WeakSet(), 0);

  return event;
}

/* =========================================================
   INIT
   ========================================================= */

/**
 * Initialize @sentry/node. Idempotent — a second call is a no-op. A no-op
 * (with one info log) when SENTRY_DSN_ENGINE is missing or empty; never throws.
 */
export function initSentry(): void {
  if (attempted) return;
  attempted = true;

  const dsn = (process.env.SENTRY_DSN_ENGINE ?? "").trim();
  const environment =
    process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? "development";

  if (!dsn) {
    logger.info(
      { event: "sentry_disabled" },
      "Sentry not configured (SENTRY_DSN_ENGINE missing) — error tracking disabled"
    );
    return;
  }

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    release: process.env.RENDER_GIT_COMMIT ?? "unknown",
    beforeSend(event) {
      return scrubEvent(event);
    }
  });

  enabled = true;

  logger.info(
    { event: "sentry_initialized", environment },
    "Sentry error tracking initialized"
  );
}

/** True once Sentry has been initialized with a DSN. */
export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Report an unexpected error to Sentry. No-op when Sentry is not configured.
 * Thin wrapper over Sentry.captureException so call sites do not each import
 * the full SDK and so capture stays a single, testable seam.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Re-export for callers needing the raw SDK (e.g. setupExpressErrorHandler). */
export { Sentry };
