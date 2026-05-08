/**
 * Next.js multipart proxy for vendor-assurance document uploads.
 *
 * The browser's <form enctype="multipart/form-data"> POSTs here with the
 * session cookie; this handler reads the engine token from the iron-session
 * (server-only — the token never reaches the browser) and forwards the
 * multipart body to the engine's POST /api/vendor-assurance/documents.
 *
 * Returns the engine response status + JSON unchanged so the upload form can
 * redirect to /vendor-assurance/{documentId} on success.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const formData = await req.formData();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${ENGINE_URL}/api/vendor-assurance/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      signal: controller.signal
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    // If the upload succeeded, the engine returned a document row. Redirect
    // the browser to the review page; for non-2xx, return the JSON so the
    // form can render the error.
    if (res.ok && parsed && typeof parsed === "object" && "document" in parsed) {
      const doc = (parsed as { document: { id: string } }).document;
      const url = new URL(`/vendor-assurance/${doc.id}`, req.nextUrl.origin);
      return NextResponse.redirect(url, { status: 303 });
    }
    return NextResponse.json(parsed ?? { error: "upload_failed" }, { status: res.status });
  } catch {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
