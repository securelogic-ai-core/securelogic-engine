import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies POST /api/enterprise-relationships (create an intra-org edge) from the browser
 * to the engine with the session token. Engine gating (404 flag-off / 403 capability) is
 * passed straight through. Mirrors the /api/risks/[id]/lifecycle proxy.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const bodyText = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/enterprise-relationships`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: bodyText,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
