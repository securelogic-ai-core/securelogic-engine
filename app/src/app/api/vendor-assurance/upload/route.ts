/**
 * Next.js multipart proxy for vendor-assurance document uploads.
 *
 * The browser's <form enctype="multipart/form-data"> POSTs here with the
 * session cookie; this handler reads the engine token from the iron-session
 * (server-only — the token never reaches the browser) and forwards the
 * multipart body to the engine's POST /api/vendor-assurance/documents.
 *
 * Returns the engine response status + JSON unchanged so the upload form can
 * navigate to /vendor-assurance/{documentId} on success via router.push.
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Per-request structured trace. Next.js in `next start` mode emits NO
  // per-request access logs on the happy path; without these two lines,
  // a successful proxy pass is indistinguishable from "handler never ran"
  // in the Render log stream. Matches the field shape of the engine's
  // pino-http output (requestId / latencyMs / status) and propagates the
  // same x-request-id forward so proxy logs and engine logs correlate.
  // Engine's requestId middleware accepts /^[a-zA-Z0-9._-]+$/ up to 128
  // chars; a plain UUID matches that allowlist.
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log("[vendor-assurance/upload] start", {
    requestId,
    contentLength: req.headers.get("content-length"),
  });

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    // eslint-disable-next-line no-console
    console.log("[vendor-assurance/upload] end", {
      requestId,
      status: 401,
      latencyMs: Date.now() - startedAt,
      reason: "unauthenticated",
    });
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Parse the multipart body in its own try/catch. `req.formData()` can
  // throw on a malformed boundary, an oversized body, or a partial read
  // (edge terminating the upload mid-stream on a slow client). Previously
  // this threw OUTSIDE the try block below, the handler crashed uncaught,
  // and the platform returned a generic 5xx (or no response at all) — which
  // is what surfaced in the browser as "Network error — please try again."
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    const detail = ((err as Error)?.message ?? "form data parse failed").slice(0, 500);
    // eslint-disable-next-line no-console
    console.error("[vendor-assurance/upload] formData parse failed:", {
      requestId,
      name:    (err as Error)?.name,
      message: (err as Error)?.message,
      error:   err,
    });
    // eslint-disable-next-line no-console
    console.log("[vendor-assurance/upload] end", {
      requestId,
      status: 400,
      latencyMs: Date.now() - startedAt,
      reason: "form_data_invalid",
    });
    return NextResponse.json(
      { error: "form_data_invalid", detail },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${ENGINE_URL}/api/vendor-assurance/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-request-id": requestId,
      },
      body: formData,
      signal: controller.signal
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    // Return engine response (status + JSON) directly. Previously the
    // success path emitted a 303 redirect to /vendor-assurance/{id}; that
    // forced the browser's fetch to follow the redirect into the SSR
    // review page, which intermittently threw `TypeError: Load failed` on
    // iOS Safari (engine answered cleanly; the failure was in the
    // post-redirect SSR fetch chain). The form now reads body.document.id
    // and navigates client-side via router.push.
    const docId =
      res.ok && parsed && typeof parsed === "object" && "document" in parsed
        ? (parsed as { document: { id?: string } }).document?.id ?? null
        : null;
    // eslint-disable-next-line no-console
    console.log("[vendor-assurance/upload] end", {
      requestId,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      documentId: docId,
    });
    return NextResponse.json(
      parsed ?? { error: "upload_failed" },
      { status: res.status }
    );
  } catch (err) {
    // Engine fetch failed (abort/timeout, DNS, TLS, connection reset, or
    // unexpected throw inside fetch). Previously this was `catch {}` and
    // emitted a bare 502 with no diagnostic — the same silent-swallow
    // pattern Ask had pre-adced86c. Surface name/message/cause in the
    // server log AND (truncated) the response detail so the next failure
    // is debuggable from logs OR a screenshot, without devtools.
    const e = err as { name?: string; message?: string; cause?: unknown } | null | undefined;
    const detail = (e?.message ?? "engine fetch failed").slice(0, 500);
    // eslint-disable-next-line no-console
    console.error("[vendor-assurance/upload] engine fetch failed:", {
      requestId,
      name:    e?.name,
      message: e?.message,
      cause:   e?.cause,
      error:   err,
    });
    // eslint-disable-next-line no-console
    console.log("[vendor-assurance/upload] end", {
      requestId,
      status: 502,
      latencyMs: Date.now() - startedAt,
      reason: "engine_fetch_failed",
      errorName: e?.name,
    });
    return NextResponse.json(
      { error: "upload_failed", detail },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
