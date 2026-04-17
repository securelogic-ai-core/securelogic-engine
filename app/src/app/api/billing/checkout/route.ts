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
 *
 * Body (form-encoded): tier = "professional" | "team"
 */
/**
 * Resolves the public-facing origin from request headers.
 *
 * Behind Render's reverse proxy, request.url contains the internal
 * Next.js URL (localhost:3000). The real external origin is in the
 * x-forwarded-proto and x-forwarded-host headers.
 */
function getOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  const origin = getOrigin(request);
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    return NextResponse.redirect(`${origin}/login`, { status: 303 });
  }

  // Parse tier from form data. Default to "professional" so existing buttons
  // without a tier field continue to work (forward compat).
  let tier: "professional" | "teams" | "team" = "professional";
  try {
    const form = await request.formData();
    const raw = form.get("tier");
    if (raw === "team") tier = "team";
    else if (raw === "teams") tier = "teams";
  } catch {
    // formData() throws if content-type is not multipart/form-data —
    // fall through to the default tier
  }

  const result = await createCheckoutSession(token, tier);

  if (!result) {
    return NextResponse.redirect(`${origin}/account?billing_error=checkout_failed`, {
      status: 303,
    });
  }

  return NextResponse.redirect(result.checkoutUrl, { status: 303 });
}
