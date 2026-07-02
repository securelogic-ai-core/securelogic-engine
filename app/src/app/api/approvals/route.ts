import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies GET /api/approvals (org-wide approvals queue) to the engine,
 * attaching the session token and forwarding status/limit query params.
 * Returns 404 straight through when the risk-lifecycle flag is off so the
 * approvals page can render an "unavailable" state.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const qs = request.nextUrl.searchParams.toString();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/approvals${qs ? `?${qs}` : ""}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
