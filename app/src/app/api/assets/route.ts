import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies POST /api/assets (create a detail-backed registry asset) from the
 * browser to the engine, attaching the session token. The engine gates the
 * route behind SECURELOGIC_ASSET_REGISTRY_ENABLED (404 when off) + the
 * `enterprise_context` capability (403 when absent) — both statuses pass
 * straight through so the client can hide the feature (404) or show an
 * entitlement affordance (403). Mirrors the /api/enterprise-context/entities
 * proxy. Tenant isolation stays in the engine (asTenant + org scoping); this
 * layer only forwards the token.
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
    upstream = await fetch(`${ENGINE_URL}/api/assets`, {
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
