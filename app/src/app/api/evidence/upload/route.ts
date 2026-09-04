import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

/**
 * Proxies POST /api/evidence/upload — the multipart Remediation Evidence file
 * upload. Attaches the session token server-side (the browser never holds it) and
 * forwards the multipart body to the engine, which validates, stores, and creates
 * the evidence row. Authorization is enforced by the engine (requireApiKey +
 * requireEntitlement + org scoping); this proxy only bridges the session token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_multipart_body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    // Forward the FormData as-is; fetch sets a fresh multipart boundary. Do NOT
    // set Content-Type manually or the boundary would be wrong.
    upstream = await fetch(`${ENGINE_URL}/api/evidence/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }
  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
