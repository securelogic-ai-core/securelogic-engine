import { NextResponse } from "next/server";
import { authForgotPassword } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body  = (await request.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email) await authForgotPassword(email);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
