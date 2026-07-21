import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies POST /api/enterprise-entities (create an enterprise-context entity) from the
 * browser to the engine, attaching the session token. The engine gates the route behind
 * SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED (404 when off) + the `enterprise_context`
 * capability (403 when absent) — both statuses are passed straight through so the client
 * can hide the feature (404) or show an entitlement affordance (403). Mirrors the
 * /api/risks/[id]/lifecycle proxy.
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
    upstream = await fetch(`${ENGINE_URL}/api/enterprise-entities`, {
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
