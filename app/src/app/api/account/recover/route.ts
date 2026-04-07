import { NextResponse } from "next/server";
import { requestRecovery } from "@/lib/api";

/**
 * POST /api/account/recover
 * { email: string }
 *
 * Proxies a recovery request to the engine. Always returns { ok: true }
 * regardless of whether the email is registered — no enumeration.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";

    // Fire and forget — engine always responds ok
    await requestRecovery(email);

    return NextResponse.json({ ok: true });
  } catch {
    // Never reveal internal errors — always ok
    return NextResponse.json({ ok: true });
  }
}
