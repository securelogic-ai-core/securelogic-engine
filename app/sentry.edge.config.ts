/**
 * Sentry edge-runtime configuration for the SecureLogic app.
 *
 * Covers Next.js middleware and any edge-runtime route handlers. Uses the
 * server-only DSN (SENTRY_DSN_APP — NOT public). Inert when unset. Loaded by
 * the Next.js instrumentation hook (src/instrumentation.ts) on the edge runtime.
 */

import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "./sentry.scrub";

const dsn = process.env.SENTRY_DSN_APP;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? "development",
  release: process.env.RENDER_GIT_COMMIT,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    return scrubEvent(event);
  },
});
