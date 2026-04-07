import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createCheckoutSession } from "@/lib/api";

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe checkout session via the engine and issues a 303
 * redirect to the Stripe-hosted checkout page. Using 303 (See Other)
 * ensures the browser makes a GET to the Stripe URL regardless of the
 * original method, which is what Stripe's hosted checkout expects.
 *
 * HTML <form method="POST"> buttons follow 303 redirects automatically —
 * no client-side JavaScript required for the happy path.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const session = await getSession();

  if (!session.apiKey) {
    return NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  const result = await createCheckoutSession(session.apiKey);

  if (!result) {
    return NextResponse.redirect(`${origin}/account?billing_error=checkout_failed`, {
      status: 303,
    });
  }

  return NextResponse.redirect(result.checkoutUrl, { status: 303 });
}
