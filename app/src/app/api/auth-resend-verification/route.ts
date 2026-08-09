import { NextResponse } from "next/server";
import { authResendVerification } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body  = (await request.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!email) {
      // Always ok — enumeration prevention. Nothing was attempted, but saying
      // so would distinguish this caller from one with a real address.
      return NextResponse.json({ ok: true, verification_email: "attempted" });
    }

    // Pass the engine's verdict through. It is address-independent by
    // construction, so forwarding it costs no enumeration resistance — and
    // without it the UI answers "Verification email resent" even when no mail
    // provider is configured and nothing was sent.
    const result = await authResendVerification(email);
    return NextResponse.json({ ok: true, verification_email: result.verificationEmail });
  } catch {
    return NextResponse.json({ ok: true, verification_email: "attempted" });
  }
}
