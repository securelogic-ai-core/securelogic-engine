import { NextResponse } from "next/server";
import { authResetPassword } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body     = (await request.json()) as { token?: unknown; password?: unknown };
    const token    = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!token || !password) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const result = await authResetPassword(token, password);

    if ("error" in result) {
      const status =
        result.error === "token_not_found_or_expired" ? 404 :
        result.error === "token_expired" ? 410 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "reset_failed" }, { status: 500 });
  }
}
