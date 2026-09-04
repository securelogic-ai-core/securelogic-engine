import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

export async function POST(request: Request) {
  const session = await getSession();
  const token   = session.jwtToken;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { password?: unknown; code?: unknown };

  const res = await fetch(`${ENGINE_URL}/api/auth/mfa/disable`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`
    },
    body:  JSON.stringify({ password: body.password, code: body.code }),
    cache: "no-store"
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
