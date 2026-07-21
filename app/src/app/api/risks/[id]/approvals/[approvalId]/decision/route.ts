import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies POST /api/risks/:id/approvals/:approvalId/decision (approve | reject)
 * to the engine. SoD (409 sod_violation), authority (403 approver_role_required),
 * and read-only (403 read_only_access) are passed straight through so the queue
 * can render them.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; approvalId: string }> }
): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { id, approvalId } = await params;
  const payload = await request.json().catch(() => ({}));

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/risks/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
