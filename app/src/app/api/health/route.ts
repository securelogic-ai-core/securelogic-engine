import { NextResponse } from "next/server";

/**
 * Readiness probe for the Next app (Render `healthCheckPath`).
 *
 * WHY A DEDICATED ROUTE RATHER THAN A PAGE: the staging app previously pointed
 * `healthCheckPath` at `/login`. That proves Next is serving HTML and nothing
 * more — an app booted without `SESSION_SECRET` or `ENGINE_API_URL` renders
 * `/login` perfectly while being unable to authenticate anyone or reach the
 * engine. A probe that cannot distinguish "serving" from "working" will report
 * a broken deploy as healthy, which is the failure mode a health check exists
 * to prevent.
 *
 * WHY IT DOES NOT CALL THE ENGINE OR THE DATABASE: Render restarts and refuses
 * to promote a service whose health check fails. If this route depended on the
 * engine, an engine blip would take the app down with it and turn a single-
 * service incident into a two-service outage. Readiness here means "this
 * process is correctly configured to serve", never "every dependency is up".
 * Dependency health belongs to the engine's own `/health`.
 *
 * The two checks below are exactly the app's hard runtime requirements:
 *
 *   SESSION_SECRET  — `middleware.ts` deliberately fails OPEN when this is
 *                     missing or shorter than 32 characters, so session
 *                     enforcement is silently disabled rather than locking
 *                     everyone out. Serving traffic in that state is a
 *                     security posture the app should never be promoted into,
 *                     and nothing else in the stack would report it.
 *
 *   ENGINE_API_URL  — every server-side engine call defaults to
 *                     `http://localhost:4000` when unset. In a Render service
 *                     nothing listens there, so the app renders shells and
 *                     fails every data fetch while looking alive.
 *
 * Both are process-local reads: no I/O, no mutation, no authentication (the
 * middleware matcher excludes `/api`), and no secret ever leaves the process —
 * the response names failing checks, never their values.
 */

/** Names of the env vars this probe requires. Values are never read out. */
const SESSION_SECRET_MIN_LENGTH = 32;

export type ReadinessResult = {
  ready: boolean;
  /** Names of failed checks — never values. Empty when ready. */
  failed: string[];
};

/**
 * Pure readiness evaluation, separated from the handler so both the ready and
 * unready branches are unit-testable without standing up a server.
 */
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
  } else if (env.NODE_ENV === "production" && /^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(engineUrl)) {
    // The localhost default is correct for local development and never correct
    // for a deployed service, so this arm is production-only.
    failed.push("ENGINE_API_URL");
  }

  return { ready: failed.length === 0, failed };
}

// Never statically optimized: the probe must read the live environment on every
// request, not a value captured at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { ready, failed } = evaluateReadiness(process.env);

  if (!ready) {
    return NextResponse.json(
      { status: "unready", failed },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { status: "ok" },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
