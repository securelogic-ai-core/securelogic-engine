/**
 * BFF proxy for downloading a self-export bundle (GDPR/CCPA, user_self scope).
 *
 * The engine answers GET /api/data-exports/:fileId/download with a 302 to a
 * short-lived signed R2 URL. We deliberately do NOT follow that redirect
 * server-side, and we do NOT re-emit the 302 to the browser. Instead we read
 * the Location header and return it as JSON {url}; the client navigates via
 * window.location (decision D). That keeps 410/404 handling clean — they come
 * back as JSON errors the client can render inline ("expired — request a new
 * export") rather than as a thrown redirect the fetch layer would auto-follow.
 *
 * The JWT comes from the iron-session cookie (server-only) and is forwarded as
 * Authorization: Bearer — the signed URL is the only thing that reaches the
 * browser, and only at click time.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> }
): Promise<NextResponse> {
  const { fileId } = await params;

  const session = await getSession();
  const jwtToken = session.jwtToken;
  if (!jwtToken) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let engineRes: Response;
  try {
    engineRes = await fetch(
      `${ENGINE_URL}/api/data-exports/${encodeURIComponent(fileId)}/download`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${jwtToken}` },
        redirect: "manual",
        cache: "no-store",
      }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  // Happy path: 302 → signed R2 URL. Hand the URL to the client as JSON.
  if (engineRes.status >= 300 && engineRes.status < 400) {
    const location = engineRes.headers.get("location");
    if (!location) {
      return NextResponse.json({ error: "download_url_unavailable" }, { status: 502 });
    }
    return NextResponse.json({ url: location });
  }

  // 410 export_purged / export_expired, 404 export_not_found — surface the
  // engine's own error code + status so the client shows the right message.
  if (engineRes.status === 410 || engineRes.status === 404) {
    const body = (await engineRes.json().catch(() => ({}))) as { error?: string };
    return NextResponse.json(
      {
        error:
          body.error ??
          (engineRes.status === 410 ? "export_expired" : "export_not_found"),
      },
      { status: engineRes.status }
    );
  }

  return NextResponse.json({ error: "download_failed" }, { status: 502 });
}
