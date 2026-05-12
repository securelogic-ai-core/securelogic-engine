/**
 * Vendor-assurance PDF stream-through proxy.
 *
 * The browser (react-pdf in PdfPreview.tsx) requests this same-origin path with
 * the session cookie. This handler:
 *
 *   1. reads the engine token from the iron-session (server-only),
 *   2. calls the engine's GET /api/vendor-assurance/documents/:id/pdf with the
 *      Bearer token and redirect: "manual",
 *   3. reads the Location header from the engine's 302 — a single-org pre-signed
 *      R2 URL with a short TTL,
 *   4. fetches that pre-signed URL server-side,
 *   5. streams the PDF bytes back to the browser.
 *
 * We deliberately do NOT 302 the browser to R2 directly:
 *   - the app's CSP connect-src does not (and should not) allow the R2 host;
 *   - a pre-signed URL in browser history / referer logs is a credential leak;
 *   - same-origin bytes are a prerequisite for the planned span-highlighting
 *     overlay (Package 1.5).
 *
 * Node runtime (not edge) — we proxy two upstream requests and stream a body.
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const { documentId } = await params;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // ---- Step 1: ask the engine for the redirect to the pre-signed R2 URL.
  let engineRes: Response;
  try {
    engineRes = await fetch(
      `${ENGINE_URL}/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/pdf`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "x-request-id": requestId },
        redirect: "manual",
        cache: "no-store",
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[vendor-assurance/pdf] engine fetch failed", { requestId, documentId, error: (err as Error)?.message });
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  if (engineRes.status === 404) {
    return NextResponse.json({ error: "vendor_assurance_document_not_found" }, { status: 404 });
  }
  if (engineRes.status === 401 || engineRes.status === 403) {
    return NextResponse.json({ error: "forbidden" }, { status: engineRes.status });
  }

  // The engine answers 302 with Location: <pre-signed R2 URL>. Some upstreams
  // may answer 200 directly with the bytes (e.g. a future local-disk backend) —
  // handle that by streaming engineRes through.
  let pdfStreamRes: Response;
  if (engineRes.status >= 300 && engineRes.status < 400) {
    const location = engineRes.headers.get("location");
    if (!location) {
      // eslint-disable-next-line no-console
      console.error("[vendor-assurance/pdf] engine redirect missing Location", { requestId, documentId, status: engineRes.status });
      return NextResponse.json({ error: "pdf_url_unavailable" }, { status: 502 });
    }
    try {
      pdfStreamRes = await fetch(location, { method: "GET", cache: "no-store" });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[vendor-assurance/pdf] R2 fetch failed", { requestId, documentId, error: (err as Error)?.message });
      return NextResponse.json({ error: "pdf_fetch_failed" }, { status: 502 });
    }
  } else if (engineRes.ok) {
    pdfStreamRes = engineRes;
  } else {
    // eslint-disable-next-line no-console
    console.error("[vendor-assurance/pdf] unexpected engine status", { requestId, documentId, status: engineRes.status });
    return NextResponse.json({ error: "pdf_unavailable" }, { status: 502 });
  }

  if (!pdfStreamRes.ok || !pdfStreamRes.body) {
    // eslint-disable-next-line no-console
    console.error("[vendor-assurance/pdf] storage response not ok", { requestId, documentId, status: pdfStreamRes.status });
    return NextResponse.json({ error: "pdf_fetch_failed" }, { status: 502 });
  }

  const contentType = pdfStreamRes.headers.get("content-type") ?? "application/pdf";
  const contentLength = pdfStreamRes.headers.get("content-length");
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    // Never let an intermediary cache the bytes — the upstream URL is short-lived
    // and the document is org-scoped.
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": "inline",
  };
  if (contentLength) headers["Content-Length"] = contentLength;

  return new NextResponse(pdfStreamRes.body, { status: 200, headers });
}
