import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies GET /api/risks/:id/lifecycle (current state + gates + allowed
 * transitions) from the browser to the engine, attaching the session
 * token. Mirrors the /api/risks/[id]/history proxy. When the risk-lifecycle
 * feature flag is off the engine returns 404 — passed straight through so the
 * client can simply not render lifecycle affordances.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { id } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/risks/${encodeURIComponent(id)}/lifecycle`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
