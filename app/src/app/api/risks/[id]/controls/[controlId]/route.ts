import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * RR-4 — Soft-delete a single risk-control link.
 *
 *   DELETE /api/risks/[id]/controls/[controlId]
 *
 * Forwards to DELETE /api/risks/:id/controls/:controlId on the engine.
 * Engine returns 204 on success; we propagate that without a body.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; controlId: string }> }
): Promise<Response> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { id, controlId } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/risks/${encodeURIComponent(id)}/controls/${encodeURIComponent(controlId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  // 204 has no body; pass through without trying to parse JSON.
  if (upstream.status === 204) {
    return new Response(null, { status: 204 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
