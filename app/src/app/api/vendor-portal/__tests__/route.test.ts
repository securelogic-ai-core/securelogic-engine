/**
 * Proxy contract tests for /api/vendor-portal/[...path].
 *
 * What must hold, because the portal cookie flow depends on it:
 *  - every engine Set-Cookie header is passed back VERBATIM (path
 *    /api/vendor-portal included — never rewritten), and multiple Set-Cookie
 *    headers survive un-joined;
 *  - the incoming Cookie header is forwarded to the engine;
 *  - the proxy is structurally credential-free: no Authorization header is
 *    ever attached, whatever the caller sends;
 *  - status + body pass through unchanged;
 *  - a valid incoming x-request-id is propagated, an invalid one is replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST, DELETE } from "../[...path]/route";

type CapturedCall = { url: string; init: RequestInit & { headers: Record<string, string> } };

function engineResponse(opts: {
  status?: number;
  body?: unknown;
  setCookies?: string[];
}) {
  const payload = new TextEncoder().encode(JSON.stringify(opts.body ?? { ok: true }));
  return {
    status: opts.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null,
      getSetCookie: () => opts.setCookies ?? [],
    },
    arrayBuffer: async () => payload.buffer,
  };
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe("vendor-portal proxy", () => {
  const calls: CapturedCall[] = [];
  let nextEngineResponse: ReturnType<typeof engineResponse>;

  beforeEach(() => {
    calls.length = 0;
    nextEngineResponse = engineResponse({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init: init as CapturedCall["init"] });
        return nextEngineResponse;
      })
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes every engine Set-Cookie header back verbatim, un-joined", async () => {
    const sessionCookie =
      "sl_vendor_portal=abc123; Path=/api/vendor-portal; Expires=Wed, 01 Jan 2027 00:00:00 GMT; HttpOnly; SameSite=Lax";
    const secondCookie = "sl_other=x; Path=/api/vendor-portal";
    nextEngineResponse = engineResponse({
      status: 200,
      body: { ok: true },
      setCookies: [sessionCookie, secondCookie],
    });

    const req = new NextRequest("http://localhost:3000/api/vendor-portal/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "tok" }),
    });
    const res = await POST(req, ctx(["session"]));

    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toEqual([sessionCookie, secondCookie]);
    // The cookie path is NOT rewritten — it is valid on the app origin as-is.
    expect(setCookies[0]).toContain("Path=/api/vendor-portal");
  });

  it("forwards the incoming Cookie header and the request body to the engine", async () => {
    const req = new NextRequest("http://localhost:3000/api/vendor-portal/questions/req-1", {
      method: "PUT",
      headers: {
        cookie: "sl_vendor_portal=abc123",
        "content-type": "application/json",
      },
      body: JSON.stringify({ answer: "pass", notes: "ok" }),
    });
    const { PUT } = await import("../[...path]/route");
    const res = await PUT(req, ctx(["questions", "req-1"]));

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/vendor-portal/questions/req-1");
    expect(calls[0].init.headers["cookie"]).toBe("sl_vendor_portal=abc123");
    const forwarded = new TextDecoder().decode(calls[0].init.body as ArrayBuffer);
    expect(JSON.parse(forwarded)).toEqual({ answer: "pass", notes: "ok" });
  });

  it("never attaches an Authorization header, even when the caller sends one", async () => {
    const req = new NextRequest("http://localhost:3000/api/vendor-portal/engagement", {
      method: "GET",
      headers: {
        cookie: "sl_vendor_portal=abc123",
        authorization: "Bearer internal-jwt-that-must-not-cross",
      },
    });
    await GET(req, ctx(["engagement"]));

    expect(calls).toHaveLength(1);
    const headerNames = Object.keys(calls[0].init.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain("authorization");
  });

  it("returns engine status and body unchanged (401 pass-through)", async () => {
    nextEngineResponse = engineResponse({
      status: 401,
      body: { error: "portal_session_invalid" },
    });
    const req = new NextRequest("http://localhost:3000/api/vendor-portal/engagement", {
      method: "GET",
    });
    const res = await GET(req, ctx(["engagement"]));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "portal_session_invalid" });
  });

  it("propagates a valid x-request-id and replaces an invalid one", async () => {
    const req = new NextRequest("http://localhost:3000/api/vendor-portal/engagement", {
      method: "GET",
      headers: { "x-request-id": "trace-1.abc_DEF" },
    });
    await GET(req, ctx(["engagement"]));
    expect(calls[0].init.headers["x-request-id"]).toBe("trace-1.abc_DEF");

    calls.length = 0;
    const bad = new NextRequest("http://localhost:3000/api/vendor-portal/engagement", {
      method: "GET",
      headers: { "x-request-id": "bad id with spaces!!" },
    });
    await GET(bad, ctx(["engagement"]));
    expect(calls[0].init.headers["x-request-id"]).toMatch(/^[a-zA-Z0-9._-]{1,128}$/);
    expect(calls[0].init.headers["x-request-id"]).not.toBe("bad id with spaces!!");
  });

  it("sends no body on DELETE", async () => {
    const req = new NextRequest("http://localhost:3000/api/vendor-portal/evidence/ev-1", {
      method: "DELETE",
      headers: { cookie: "sl_vendor_portal=abc123" },
    });
    const res = await DELETE(req, ctx(["evidence", "ev-1"]));
    expect(res.status).toBe(200);
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].url).toContain("/api/vendor-portal/evidence/ev-1");
  });

  it("answers 502 portal_unavailable when the engine is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    const req = new NextRequest("http://localhost:3000/api/vendor-portal/engagement", {
      method: "GET",
    });
    const res = await GET(req, ctx(["engagement"]));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "portal_unavailable" });
  });
});
