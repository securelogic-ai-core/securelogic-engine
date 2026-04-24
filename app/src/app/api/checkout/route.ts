import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createCheckoutSession } from "@/lib/api";

/**
 * POST /api/checkout
 *
 * JSON endpoint for client-side checkout button with loading state.
 * Reads jwtToken (or legacy apiKey) from the iron-session cookie,
 * proxies to the engine, and returns { checkoutUrl } as JSON.
 *
 * The client calls this, receives the URL, then does
 * window.location.href = checkoutUrl.
 *
 * Body (JSON): { tier: "professional" | "team" }
 */
export async function POST(request: Request) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let tier: "professional" | "team" = "professional";
  try {
    const body = (await request.json()) as { tier?: string };
    if (body.tier === "team") tier = "team";
  } catch {
    // fall through to default tier
  }

  const result = await createCheckoutSession(token, tier);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ checkoutUrl: result.url });
}
