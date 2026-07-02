import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies DELETE /api/risks/:id/evidence/:evidenceId (Epic R4) — SOFT detach of
 * a risk-attached evidence record. Engine 404 (flag off / not found) passes
 * through unchanged.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; evidenceId: string }> }
): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const { id, evidenceId } = await params;
  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/risks/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}`,
      {
        method: "DELETE",
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
