import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * RR-6 — Soft-delete a single risk-obligation link.
 *
 *   DELETE /api/risks/[id]/obligations/[obligationId]
 *
 * Forwards to DELETE /api/risks/:id/obligations/:obligationId on the engine.
 * Engine returns 204 on success; we propagate that without a body.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; obligationId: string }> }
): Promise<Response> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { id, obligationId } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/risks/${encodeURIComponent(id)}/obligations/${encodeURIComponent(obligationId)}`,
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
