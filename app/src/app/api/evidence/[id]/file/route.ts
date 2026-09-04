import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

/**
 * Proxies GET /api/evidence/:id/file — the authenticated download for a
 * file-backed evidence row. The engine returns a 302 to a short-lived, single-org
 * pre-signed URL; this proxy forwards that redirect to the browser so the token
 * never leaves the server and there is never a public object URL. Org scoping and
 * "does this evidence have a file" are enforced by the engine (404 otherwise).
 */
export async function GET(
  _request: NextRequest,
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
    upstream = await fetch(`${ENGINE_URL}/api/evidence/${encodeURIComponent(id)}/file`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual", // capture the 302 rather than following it server-side
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  // Engine issued a signed URL — hand the redirect to the browser.
  if (upstream.status === 302 || upstream.status === 307) {
    const location = upstream.headers.get("location");
    if (location) {
      return NextResponse.redirect(location, 302);
    }
    return NextResponse.json({ error: "signed_url_failed" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
