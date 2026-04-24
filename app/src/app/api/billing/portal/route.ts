import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createPortalSession } from "@/lib/api";
import { getOrigin } from "@/lib/getOrigin";

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

  if (!token) {
    return NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  const result = await createPortalSession(token);

  if ("error" in result) {
    const reason = encodeURIComponent(result.error);
    return NextResponse.redirect(
      `${origin}/account?billing_error=portal_failed&reason=${reason}`,
      { status: 303 }
    );
  }

  return NextResponse.redirect(result.url, { status: 303 });
}
