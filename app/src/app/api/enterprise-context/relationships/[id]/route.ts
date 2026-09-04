import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

/**
 * Proxies DELETE /api/enterprise-relationships/:id (soft-delete an edge) from the browser
 * to the engine with the session token. Engine gating (404 flag-off / 403 capability) is
 * passed straight through. Mirrors the /api/risks/[id]/lifecycle proxy.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/enterprise-relationships/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
