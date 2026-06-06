/**
 * Next.js instrumentation hook — wires the Sentry server/edge configs into the
 * correct runtime. Required by @sentry/nextjs: the sentry.server.config and
 * sentry.edge.config files at the app root are loaded here (not auto-imported
 * like the client config). Manual setup — the auto-wizard is intentionally not
 * run (it rewrites next.config and other files destructively).
 *
 * Lives under src/ because this app uses the src-directory layout; the config
 * files sit at the app root, hence the "../" import paths.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Captures errors thrown in nested React Server Components / route handlers and
// forwards them to Sentry. No-op when Sentry is not initialized (no DSN).
export { captureRequestError as onRequestError } from "@sentry/nextjs";
