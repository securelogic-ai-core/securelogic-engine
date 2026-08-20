/**
 * route.test.ts — #823: the SSO callback must redirect to the PUBLIC origin.
 *
 * This route runs in the Node runtime, where `request.url` behind Render's proxy
 * carries the internal bind address (https://localhost:10000). Every redirect
 * used to be built against it, so a browser completing SSO was sent to
 * `https://localhost:10000/dashboard` — its own machine — and the login could
 * not finish, even though the code exchange, the session and the cookie were all
 * correct. Five error redirects had the same defect with a quieter symptom.
 *
 * These tests pin the external origin for EVERY redirect branch, and assert that
 * the internal host cannot leak into any of them. They also pin local
 * development, where there is no proxy and the Host header is the right answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getAuthMe = vi.fn();
const save = vi.fn();

vi.mock("@/lib/api", () => ({ getAuthMe: (...a: unknown[]) => getAuthMe(...a) }));
vi.mock("@/lib/session", () => ({ getSessionOptions: () => ({ password: "x".repeat(32), cookieName: "sl_session" }) }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({}) }));
vi.mock("iron-session", () => ({
  getIronSession: () => Promise.resolve(new Proxy({ save }, {
    set: () => true,
    get: (t, k) => (k === "save" ? save : (t as Record<string | symbol, unknown>)[k]),
  })),
}));

import { GET } from "../route";

/** The internal address Render's proxy forwards to — must never reach a browser. */
const INTERNAL = "https://localhost:10000";
const EXTERNAL_HOST = "securelogic-app-staging.onrender.com";
const EXTERNAL = `https://${EXTERNAL_HOST}`;

/**
 * A request as the Node runtime sees it behind the proxy: request.url is the
 * INTERNAL address, and the public origin is only in the forwarded headers.
 */
function proxiedRequest(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`${INTERNAL}/api/auth-sso-callback${query}`, {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": EXTERNAL_HOST,
      host: "localhost:10000",
      ...headers,
    },
  });
}

/** Local development: no proxy, so the Host header IS the public origin. */
function localRequest(query = ""): Request {
  return new Request(`http://localhost:3000/api/auth-sso-callback${query}`, {
    headers: { host: "localhost:3000" },
  });
}

function location(res: Response): string {
  return res.headers.get("location") ?? "";
}

beforeEach(() => {
  getAuthMe.mockReset();
  save.mockReset();
  delete process.env.SECURELOGIC_SSO_LEGACY_CALLBACK_DISABLED;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      token: "t.t.t", userId: "u1", email: "a@b.test", name: "A", orgId: "o1",
    }),
  } as unknown as Response));
});
afterEach(() => vi.unstubAllGlobals());

const ME = {
  id: "u1", email: "a@b.test", name: "A", organizationId: "o1",
  organizationName: "Org", entitlementLevel: "platform", role: "admin", billingActive: true,
};

describe("#823 — every redirect targets the external origin", () => {
  it("SUCCESS: /dashboard goes to the external host, not localhost:10000", async () => {
    getAuthMe.mockResolvedValue(ME);
    const res = await GET(proxiedRequest("?code=abc"));
    expect(location(res)).toBe(`${EXTERNAL}/dashboard`);
    expect(location(res)).not.toContain("localhost");
  });

  it("ERROR: failed code exchange", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as unknown as Response));
    const res = await GET(proxiedRequest("?code=abc"));
    expect(location(res)).toBe(`${EXTERNAL}/login?error=sso_callback_invalid`);
  });

  it("ERROR: legacy callback disabled", async () => {
    process.env.SECURELOGIC_SSO_LEGACY_CALLBACK_DISABLED = "true";
    const res = await GET(proxiedRequest("?token=t.t.t&userId=u1&email=a@b.test&orgId=o1"));
    expect(location(res)).toBe(`${EXTERNAL}/login?error=sso_callback_invalid`);
  });

  it("ERROR: missing required params", async () => {
    const res = await GET(proxiedRequest(""));
    expect(location(res)).toBe(`${EXTERNAL}/login?error=sso_callback_invalid`);
  });

  it("ERROR: token does not verify (getAuthMe null)", async () => {
    getAuthMe.mockResolvedValue(null);
    const res = await GET(proxiedRequest("?code=abc"));
    expect(location(res)).toBe(`${EXTERNAL}/login?error=sso_session_failed`);
  });

  it("ERROR: thrown exception still redirects externally (catch block)", async () => {
    getAuthMe.mockRejectedValue(new Error("boom"));
    const res = await GET(proxiedRequest("?code=abc"));
    expect(location(res)).toBe(`${EXTERNAL}/login?error=sso_session_failed`);
  });

  it("NO redirect branch can leak the internal host", async () => {
    const branches: Array<() => Promise<Response>> = [
      () => { getAuthMe.mockResolvedValue(ME); return GET(proxiedRequest("?code=abc")); },
      () => { getAuthMe.mockResolvedValue(null); return GET(proxiedRequest("?code=abc")); },
      () => { getAuthMe.mockRejectedValue(new Error("boom")); return GET(proxiedRequest("?code=abc")); },
      () => GET(proxiedRequest("")),
      () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as unknown as Response));
        return GET(proxiedRequest("?code=abc"));
      },
    ];
    for (const run of branches) {
      const loc = location(await run());
      expect(loc).not.toContain("localhost");
      expect(loc).not.toContain(":10000");
      expect(loc.startsWith(EXTERNAL)).toBe(true);
    }
  });
});

describe("#823 — local development is unaffected", () => {
  it("without a proxy, the Host header is the origin", async () => {
    getAuthMe.mockResolvedValue(ME);
    const res = await GET(localRequest("?code=abc"));
    // localhost:3000 here is CORRECT — it is the real public origin in dev.
    expect(location(res)).toBe("http://localhost:3000/dashboard");
  });

  it("x-forwarded-proto is honoured over the request scheme", async () => {
    getAuthMe.mockResolvedValue(ME);
    const res = await GET(new Request(`${INTERNAL}/api/auth-sso-callback?code=abc`, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": EXTERNAL_HOST, host: "localhost:10000" },
    }));
    expect(location(res)).toBe(`${EXTERNAL}/dashboard`);
  });
});

describe("#823 — SSO exchange and session behaviour unchanged", () => {
  it("the code is still exchanged server-side and the session saved", async () => {
    getAuthMe.mockResolvedValue(ME);
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: "t.t.t", userId: "u1", email: "a@b.test", name: "A", orgId: "o1" }),
    } as unknown as Response);
    vi.stubGlobal("fetch", f);

    await GET(proxiedRequest("?code=abc"));

    const [calledUrl, init] = f.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("/api/sso/exchange");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ code: "abc" });
    // Identity still comes from the VERIFIED token, and the session is persisted.
    expect(getAuthMe).toHaveBeenCalledWith("t.t.t");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("no session is saved when the token does not verify", async () => {
    getAuthMe.mockResolvedValue(null);
    await GET(proxiedRequest("?code=abc"));
    expect(save).not.toHaveBeenCalled();
  });
});
