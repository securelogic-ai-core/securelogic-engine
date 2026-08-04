/**
 * Readiness evaluation for the app's health probe.
 *
 * Lives here rather than in `app/api/health/route.ts` because Next.js validates
 * the export surface of a route module: a `route.ts` may export only route
 * handlers and the recognized segment config (`dynamic`, `runtime`, …). Exporting
 * a helper from it fails `next build` at deploy time even though a bare
 * `tsc --noEmit` accepts it, because the check runs against the route types Next
 * generates during the build. Keeping the logic in a plain module also makes it
 * directly unit-testable without touching the handler.
 *
 * These are exactly the app's two hard runtime requirements — see the route for
 * why the probe deliberately performs no engine or database call.
 */

/** Below this length `middleware.ts` ignores the secret and fails OPEN. */
const SESSION_SECRET_MIN_LENGTH = 32;

export type ReadinessResult = {
  ready: boolean;
  /** Names of failed checks — never values. Empty when ready. */
  failed: string[];
};

export function evaluateReadiness(env: NodeJS.ProcessEnv): ReadinessResult {
  const failed: string[] = [];

  const sessionSecret = (env.SESSION_SECRET ?? "").trim();
  if (sessionSecret.length < SESSION_SECRET_MIN_LENGTH) {
    // Covers both "missing" and "too short" — middleware treats them
    // identically, so the probe does too.
    failed.push("SESSION_SECRET");
  }

  const engineUrl = (env.ENGINE_API_URL ?? "").trim();
  if (engineUrl === "") {
    failed.push("ENGINE_API_URL");
  } else if (
    env.NODE_ENV === "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(engineUrl)
  ) {
    // The localhost default is correct for local development and never correct
    // for a deployed service, so this arm is production-only.
    failed.push("ENGINE_API_URL");
  }

  return { ready: failed.length === 0, failed };
}
