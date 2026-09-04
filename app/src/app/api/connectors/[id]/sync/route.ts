import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

/**
 * EAR P16: proxies POST /api/connectors/:id/sync (enqueue one discovery sync) to
 * the engine with the session token. Admin-only + dark-flag gating live on the
 * engine; its status passes through (202 accepted, 409 not_configured /
 * connector_disabled / sync_already_pending, 403 for non-admins, 404 while dark).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { id } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/connectors/${encodeURIComponent(id)}/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const payload = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(payload, { status: upstream.status });
}
