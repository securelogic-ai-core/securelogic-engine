/**
 * vendorAssuranceExportProxy.ts — shared logic for the two same-origin export
 * download routes (export.xlsx, export.pdf).
 *
 * Mirrors app/src/app/api/vendor-assurance/[documentId]/pdf/route.ts: read the
 * engine token from the server-only iron-session, call the engine's
 * POST /api/vendor-assurance/documents/:id/export.<format> with the Bearer
 * token, and stream the bytes straight back to the browser, preserving the
 * engine's Content-Type and Content-Disposition so the browser performs a
 * normal "save file" download. The engine does the audit logging; nothing is
 * persisted here.
 *
 * Node runtime — we proxy an upstream request and stream a body.
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

const FALLBACK_CONTENT_TYPE: Record<"xlsx" | "pdf", string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export async function proxyVendorAssuranceExport(
  req: NextRequest,
  documentId: string,
  format: "xlsx" | "pdf"
): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let engineRes: Response;
  try {
    engineRes = await fetch(
      `${ENGINE_URL}/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/export.${format}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-request-id": requestId },
        cache: "no-store",
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[vendor-assurance/export] engine fetch failed", { requestId, documentId, format, error: (err as Error)?.message });
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  if (engineRes.status === 404) {
    return NextResponse.json({ error: "vendor_assurance_document_not_found" }, { status: 404 });
  }
  if (engineRes.status === 409) {
    const body = await engineRes.json().catch(() => ({ error: "vendor_assurance_document_not_exportable" }));
    return NextResponse.json(body, { status: 409 });
  }
  if (engineRes.status === 401 || engineRes.status === 403) {
    return NextResponse.json({ error: "forbidden" }, { status: engineRes.status });
  }
  if (!engineRes.ok || !engineRes.body) {
    // eslint-disable-next-line no-console
    console.error("[vendor-assurance/export] unexpected engine status", { requestId, documentId, format, status: engineRes.status });
    return NextResponse.json({ error: "export_failed" }, { status: 502 });
  }

  const contentType = engineRes.headers.get("content-type") ?? FALLBACK_CONTENT_TYPE[format];
  const contentDisposition =
    engineRes.headers.get("content-disposition") ?? `attachment; filename="vendor-assurance-export.${format}"`;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition,
    "Cache-Control": "private, no-store, max-age=0",
  };
  const contentLength = engineRes.headers.get("content-length");
  if (contentLength) headers["Content-Length"] = contentLength;

  return new NextResponse(engineRes.body, { status: 200, headers });
}
