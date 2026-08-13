/**
 * Next.js catch-all proxy for the EXTERNAL vendor portal.
 *
 * Forwards /api/vendor-portal/<path> to the engine's identically-shaped
 * routes. This proxy exists so the browser talks to ONE origin: the engine's
 * httpOnly portal cookie (path=/api/vendor-portal) is valid on the app origin
 * because the path here matches byte-for-byte, and same-origin fetches from
 * the /portal pages attach it automatically.
 *
 * STRUCTURALLY CREDENTIAL-FREE. Unlike every other app proxy, this handler
 * never reads the iron-session and never attaches an Authorization header —
 * the portal cookie IS the auth and the engine enforces it. Keeping the
 * internal session out of this file is what keeps the two authentication
 * worlds disjoint on the app side, matching the engine's own invariant
 * (requirePortalSession strips organizationContext).
 *
 * Pass-through rules:
 *  - the incoming Cookie header is forwarded verbatim;
 *  - every engine Set-Cookie header is returned verbatim (the cookie path
 *    /api/vendor-portal is valid on this origin too — never rewritten);
 *  - content-type and raw body bytes are forwarded (JSON and multipart both;
 *    the engine's 25MB multer cap bounds the arrayBuffer read);
 *  - engine status + body are returned unchanged.
 *
 * Logging matches the vendor-assurance upload proxy: start/end lines with a
 * propagated x-request-id so proxy logs and engine logs correlate.
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/** Engine's requestId middleware allowlist: /^[a-zA-Z0-9._-]+$/ up to 128. */
function safeRequestId(incoming: string | null): string {
  if (incoming && /^[a-zA-Z0-9._-]{1,128}$/.test(incoming)) return incoming;
  return randomUUID();
}

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const subPath = (path ?? []).map(encodeURIComponent).join("/");
  const requestId = safeRequestId(req.headers.get("x-request-id"));
  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log("[vendor-portal/proxy] start", {
    requestId,
    method: req.method,
    path: subPath,
  });

  // Only the headers the engine needs. Never Authorization, never the app's
  // iron-session cookie name specifically — the whole Cookie header is passed
  // because the portal cookie lives in it; the engine reads only its own name.
  const headers: Record<string, string> = { "x-request-id": requestId };
  const cookie = req.headers.get("cookie");
  if (cookie) headers["cookie"] = cookie;
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  let body: ArrayBuffer | undefined;
  if (METHODS_WITH_BODY.has(req.method)) {
    try {
      body = await req.arrayBuffer();
    } catch (err) {
      const detail = ((err as Error)?.message ?? "body read failed").slice(0, 500);
      // eslint-disable-next-line no-console
      console.log("[vendor-portal/proxy] end", {
        requestId,
        status: 400,
        latencyMs: Date.now() - startedAt,
        reason: "body_read_failed",
      });
      return NextResponse.json({ error: "body_read_failed", detail }, { status: 400 });
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const engineRes = await fetch(
      `${ENGINE_URL}/api/vendor-portal/${subPath}${req.nextUrl.search}`,
      {
        method: req.method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      }
    );

    const resHeaders = new Headers();
    const resContentType = engineRes.headers.get("content-type");
    if (resContentType) resHeaders.set("content-type", resContentType);
    // Every Set-Cookie, verbatim. getSetCookie() is the only API that returns
    // them un-joined; a joined header would corrupt Expires attributes.
    for (const sc of engineRes.headers.getSetCookie()) {
      resHeaders.append("set-cookie", sc);
    }

    const payload = await engineRes.arrayBuffer();
    // eslint-disable-next-line no-console
    console.log("[vendor-portal/proxy] end", {
      requestId,
      status: engineRes.status,
      latencyMs: Date.now() - startedAt,
    });
    return new NextResponse(payload, { status: engineRes.status, headers: resHeaders });
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: unknown } | null | undefined;
    // eslint-disable-next-line no-console
    console.error("[vendor-portal/proxy] engine fetch failed:", {
      requestId,
      name: e?.name,
      message: e?.message,
      cause: e?.cause,
    });
    // eslint-disable-next-line no-console
    console.log("[vendor-portal/proxy] end", {
      requestId,
      status: 502,
      latencyMs: Date.now() - startedAt,
      reason: "engine_fetch_failed",
      errorName: e?.name,
    });
    return NextResponse.json({ error: "portal_unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(req, ctx);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(req, ctx);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(req, ctx);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return proxy(req, ctx);
}
