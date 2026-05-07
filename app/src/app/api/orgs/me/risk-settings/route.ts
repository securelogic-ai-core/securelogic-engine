import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * RR-5 — Org-level risk policy proxy.
 *
 *   GET /api/orgs/me/risk-settings  → effective policy (defaults if no row)
 *   PUT /api/orgs/me/risk-settings  → upsert policy
 */

async function authToken(): Promise<string | null> {
  const session = await getSession();
  return session.jwtToken ?? session.apiKey ?? null;
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const token = await authToken();
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/orgs/me/risk-settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const token = await authToken();
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/orgs/me/risk-settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const responseBody = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(responseBody, { status: upstream.status });
}
