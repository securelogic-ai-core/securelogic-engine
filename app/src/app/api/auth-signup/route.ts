import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { authSignup } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      organizationName?: unknown;
      name?: unknown;
      email?: unknown;
      password?: unknown;
      promoCode?: unknown;
      plan?: unknown;
      acceptedTerms?: unknown;
    };

    const organizationName = typeof body.organizationName === "string" ? body.organizationName.trim() : "";
    const name             = typeof body.name === "string" ? body.name.trim() : "";
    const email            = typeof body.email === "string" ? body.email.trim() : "";
    const password         = typeof body.password === "string" ? body.password : "";
    const promoCode        = typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode.trim() : undefined;
    const acceptedTerms    = body.acceptedTerms === true;
    const plan             =
      body.plan === "professional" ||
      body.plan === "teams" ||
      body.plan === "platform" ||
      body.plan === "platform_annual"
        ? body.plan
        : null;

    if (!organizationName || !name || !email || !password) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    // Legal consent is required. The engine also enforces this, but rejecting
    // here avoids a wasted round-trip and surfaces the same error contract.
    if (!acceptedTerms) {
      return NextResponse.json({ error: "missing_terms_acceptance" }, { status: 400 });
    }

    const result = await authSignup(organizationName, name, email, password, promoCode, acceptedTerms);

    if ("error" in result) {
      const status = result.error === "email_already_registered" ? 409 : 400;
      return NextResponse.json(result, { status });
    }

    // Stash the picked plan on the iron-session cookie so /verify-email can
    // route the user straight into Stripe checkout once their email is verified.
    // Same-browser only — cross-device verification falls through to dashboard
    // and the user re-initiates checkout from the in-app upgrade path.
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());
    if (plan) {
      session.pendingPlan = plan;
    } else {
      delete session.pendingPlan;
    }
    await session.save();

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "signup_failed" }, { status: 500 });
  }
}
