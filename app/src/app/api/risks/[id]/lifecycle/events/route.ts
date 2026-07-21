import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies GET /api/risks/:id/lifecycle/events (append-only lifecycle event
 * stream) to the engine, attaching the session token and forwarding the
 * cursor/limit query string.
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
  const qs = request.nextUrl.searchParams.toString();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/risks/${encodeURIComponent(id)}/lifecycle/events${qs ? `?${qs}` : ""}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
