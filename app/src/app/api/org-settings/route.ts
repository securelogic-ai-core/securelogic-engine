import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function GET() {
  const session = await getSession();
  const token   = session.jwtToken;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${ENGINE_URL}/api/org/settings`, {
    headers: { "Authorization": `Bearer ${token}` },
    cache:   "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

// The engine validates field-by-field (closed allow-list, unknown fields 400),
// so the proxy forwards only the known settings keys and lets the engine be
// the single source of validation truth.
const FORWARDED_KEYS = [
  "name",
  "require_mfa",
  "regulated",
  "handles_pii",
  "safety_critical",
  "scale",
] as const;

export async function PATCH(request: Request) {
  const session = await getSession();
  const token   = session.jwtToken;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const forwarded: Record<string, unknown> = {};
  for (const key of FORWARDED_KEYS) {
    if (key in body) forwarded[key] = body[key];
  }

  const res = await fetch(`${ENGINE_URL}/api/org/settings`, {
    method:  "PATCH",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body:  JSON.stringify(forwarded),
    cache: "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
