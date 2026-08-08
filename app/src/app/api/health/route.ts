import { NextResponse } from "next/server";

import { evaluateReadiness } from "@/lib/appReadiness";

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
 * The checks themselves live in `@/lib/appReadiness`: a route module may export
 * only handlers and segment config, so the helper cannot live here — exporting
 * it fails `next build` at deploy time even though bare `tsc --noEmit` accepts
 * it.
 *
 * No I/O, no mutation, no authentication (the middleware matcher excludes
 * `/api`), and no secret leaves the process: the response names failing checks,
 * never their values.
 */

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
