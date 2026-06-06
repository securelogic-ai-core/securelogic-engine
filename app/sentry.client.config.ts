/**
 * Sentry browser (client) configuration for the SecureLogic app.
 *
 * Uses the PUBLIC DSN (NEXT_PUBLIC_SENTRY_DSN_APP), which is inlined into the
 * browser bundle at build time. Inert (disabled, no events sent) when the DSN
 * is unset, so a build without the env var produces a working app with Sentry
 * simply off.
 *
 * Loaded automatically by @sentry/nextjs (via withSentryConfig) into the client
 * bundle.
 */

import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "./sentry.scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_APP;

Sentry.init({
  dsn,
  // No-op when the DSN is missing — never throws, never blocks the app.
  enabled: Boolean(dsn),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? "development",
  // NEXT_PUBLIC_RENDER_GIT_COMMIT is only present if the operator exposes it
  // client-side; when undefined Sentry falls back to its own release detection.
  release: process.env.NEXT_PUBLIC_RENDER_GIT_COMMIT,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    return scrubEvent(event);
  },
});
