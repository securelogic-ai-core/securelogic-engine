import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies GET /api/obligations from the browser to the engine. Used by the
 * client-side ObligationPicker (RR-6) so the JWT stays in the session cookie
 * rather than being shipped to the browser bundle.
 *
 * Forwards the entire query string verbatim so cursor pagination
 * (?limit, ?status, ?domain, ?before_created_at, ?before_id) works through
 * the proxy.
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
      `${ENGINE_URL}/api/obligations${qs ? `?${qs}` : ""}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
