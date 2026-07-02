import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createPortalSession } from "@/lib/api";
import { getOrigin } from "@/lib/getOrigin";
import {
  retryTransient,
  isTransientPortalResult,
  PORTAL_RETRY_BACKOFF_MS,
} from "./retry";

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe billing portal session via the engine and issues a
 * 303 redirect to the Stripe-hosted portal page. On failure, redirects
 * back to /account with both a generic billing_error code and a
 * reason= param carrying the engine's error string for debugging.
 */
export async function POST(request: Request) {
  const origin = getOrigin(request);
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;

  // The client CTA sends `x-portal-xhr: 1` and takes control of navigation, so
  // it needs the portal URL as JSON. A no-JS native form POST sends neither
  // header, so it keeps the original 303-redirect behavior (progressive
  // enhancement) — the response contract is unchanged for that path.
  const wantsJson =
    request.headers.get("x-portal-xhr") === "1" ||
    (request.headers.get("accept") ?? "").includes("application/json");

  if (!token) {
    return wantsJson
      ? NextResponse.json({ error: "unauthenticated" }, { status: 401 })
      : NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  // Bounded transient-retry to absorb a cold/restarting engine on the first
  // click. We retry ONLY the transient class (network_error / timeout — see
  // isTransientPortalResult); deterministic config/auth errors fall through
  // immediately, preserving prior behaviour. See ./retry for the policy.
  const { result, attempts } = await retryTransient(
    () => createPortalSession(token),
    {
      backoffMs: PORTAL_RETRY_BACKOFF_MS,
      shouldRetry: isTransientPortalResult,
      onAttempt: ({ attempt, result, willRetry }) => {
        if (willRetry && "error" in result) {
          console.warn(
            `[billing/portal] transient engine failure on attempt ${attempt + 1}, retrying (reason=${result.error})`
          );
        }
      },
    }
  );

  if ("error" in result) {
    if (attempts > 1) {
      console.error(
        `[billing/portal] all ${attempts} attempts failed (reason=${result.error})`
      );
    }
    const reason = encodeURIComponent(result.error);
    return wantsJson
      ? NextResponse.json(
          { error: "portal_failed", reason: result.error },
          { status: 502 }
        )
      : NextResponse.redirect(
          `${origin}/account?billing_error=portal_failed&reason=${reason}`,
          { status: 303 }
        );
  }

  if (attempts > 1) {
    console.info(
      `[billing/portal] portal session created after ${attempts} attempts`
    );
  }

  return wantsJson
    ? NextResponse.json({ url: result.url })
    : NextResponse.redirect(result.url, { status: 303 });
}
