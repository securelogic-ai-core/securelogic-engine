import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createPortalSession } from "@/lib/api";

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe billing portal session via the engine and issues a
 * 303 redirect to the Stripe-hosted portal page.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const session = await getSession();

  if (!session.apiKey) {
    return NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  const result = await createPortalSession(session.apiKey);

  if (!result) {
    return NextResponse.redirect(`${origin}/account?billing_error=portal_failed`, {
      status: 303,
    });
  }

  return NextResponse.redirect(result.portalUrl, { status: 303 });
}
