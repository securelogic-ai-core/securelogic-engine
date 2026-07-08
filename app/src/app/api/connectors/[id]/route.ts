import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * EAR P16: proxies connector configure (PUT) and disconnect (DELETE) to the
 * engine with the session token. The engine owns all authorization — admin role
 * (requireAdminRole), the ECL + asset-registry flags, and the enterprise_context
 * capability — and its status codes pass straight through (403 forbidden /
 * insufficient_permissions for non-admins, 404 while dark). The connector id is
 * forwarded as an opaque path segment; the engine validates it against the
 * registry catalog.
 */
async function forward(
  request: NextRequest,
  id: string,
  method: "PUT" | "DELETE",
): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (method === "PUT") {
    const json = await request.json().catch(() => null);
    if (json === null) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/connectors/${encodeURIComponent(id)}`, {
      method,
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const payload = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(payload, { status: upstream.status });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return forward(request, id, "PUT");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return forward(request, id, "DELETE");
}
