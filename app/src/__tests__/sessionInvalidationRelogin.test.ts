/**
 * sessionInvalidationRelogin.test.ts — the app half of SEC-JWT-EPOCH.
 *
 * The engine now rejects a session whose `se` claim is missing (every token
 * minted before that deploy) or stale (password reset/change, invite
 * reactivation). Before this change the app had no 401 branch anywhere:
 * `engineFetch` returned the response unread, `getMe` collapsed it to null, and
 * pages fell back to entitlement "starter". A user whose session the engine had
 * killed therefore saw an app that still said they were signed in and rendered
 * nothing — for up to the absolute cookie cap.
 *
 * These tests pin the two properties that fix depends on:
 *   - a session the engine has definitively invalidated is TORN DOWN by
 *     middleware (cookie cleared, redirected to /login with a true reason);
 *   - nothing else is. Ambiguity, outages, generic 401s and legacy API-key
 *     sessions all leave the session exactly where it was.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "test-session-secret-at-least-32-chars-long";
const ENGINE = "http://engine.test";

process.env.SESSION_SECRET = SECRET;
process.env.ENGINE_API_URL = ENGINE;

import { middleware } from "@/middleware";
import {
  sealSession,
  jwtSessionEpochState,
  isEngineProbeDue,
  probeEngineSession,
  ENGINE_SESSION_INVALID_ERRORS,
} from "@/lib/sessionPolicy";

/** A structurally real JWT. Signature is irrelevant — the app never verifies it. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature-not-checked-here`;
}

const NOW = () => Math.floor(Date.now() / 1000);

/** A token that predates SEC-JWT-EPOCH: no `se` claim at all. */
const PRE_EPOCH_JWT = makeJwt({ sub: "u1", org: "o1", role: "admin", iat: NOW(), exp: NOW() + 3600 });
/** A token minted after it. */
const EPOCH_JWT = makeJwt({ sub: "u1", org: "o1", role: "admin", se: 4, iat: NOW(), exp: NOW() + 3600 });

async function requestWith(
  claims: Record<string, unknown>,
  path = "/dashboard"
): Promise<NextRequest> {
  const req = new NextRequest(new URL(`http://app.test${path}`));
  req.cookies.set("sl_session", await sealSession(claims, SECRET, 12 * 60 * 60));
  return req;
}

function liveClaims(extra: Record<string, unknown> = {}) {
  const now = NOW();
  return { jwtToken: EPOCH_JWT, loginAt: now, lastActivityAt: now, ...extra };
}

/** Engine answers a probe with `status` and `body`. */
function engineAnswers(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = engineAnswers(200, { ok: true });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── the offline half: is there an epoch claim at all ───────────────────── */

describe("jwtSessionEpochState", () => {
  it("reads a present epoch", () => {
    expect(jwtSessionEpochState(EPOCH_JWT)).toBe("present");
  });

  it("epoch 0 is PRESENT, not absent — 0 is a valid generation", () => {
    expect(jwtSessionEpochState(makeJwt({ sub: "u", se: 0 }))).toBe("present");
  });

  it("a pre-SEC-JWT-EPOCH token is absent", () => {
    expect(jwtSessionEpochState(PRE_EPOCH_JWT)).toBe("absent");
  });

  it("a legacy API key is unreadable, never 'absent' — it must not trigger a logout", () => {
    expect(jwtSessionEpochState("sl_live_abcdef123456")).toBe("unreadable");
  });

  it("garbage fails open as unreadable", () => {
    for (const junk of ["", "a.b.c", "....", null, undefined, 42]) {
      expect(jwtSessionEpochState(junk)).toBe("unreadable");
    }
  });

  it("a non-numeric se is absent, not present — a string cannot be compared to an integer", () => {
    expect(jwtSessionEpochState(makeJwt({ sub: "u", se: "4" }))).toBe("absent");
  });
});

/* ── the online half: is the epoch still the current one ────────────────── */

describe("probeEngineSession", () => {
  it("401 session_epoch_missing → invalid", async () => {
    vi.stubGlobal("fetch", engineAnswers(401, { error: "session_epoch_missing" }));
    expect(await probeEngineSession(EPOCH_JWT)).toBe("invalid");
  });

  it("401 session_invalidated → invalid", async () => {
    vi.stubGlobal("fetch", engineAnswers(401, { error: "session_invalidated" }));
    expect(await probeEngineSession(EPOCH_JWT)).toBe("invalid");
  });

  it("a GENERIC 401 is NOT invalid — it must not force a logout", async () => {
    for (const code of ["invalid_or_expired_token", "unauthorized", "api_key_required", "account_inactive"]) {
      vi.stubGlobal("fetch", engineAnswers(401, { error: code }));
      expect(await probeEngineSession(EPOCH_JWT)).toBe("unknown");
    }
  });

  it("200 → valid", async () => {
    vi.stubGlobal("fetch", engineAnswers(200, { id: "u1" }));
    expect(await probeEngineSession(EPOCH_JWT)).toBe("valid");
  });

  it("5xx, a thrown fetch and an unparseable body all fail OPEN", async () => {
    // A 503 is NOT evidence the session is fine — only a 2xx is. Both leave the
    // session alone, but the verdict must not claim knowledge it does not have.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 503, json: () => Promise.resolve({}),
    } as unknown as Response));
    expect(await probeEngineSession(EPOCH_JWT)).toBe("unknown");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await probeEngineSession(EPOCH_JWT)).toBe("unknown");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 401, json: () => Promise.reject(new Error("not json")),
    } as unknown as Response));
    expect(await probeEngineSession(EPOCH_JWT)).toBe("unknown");
  });

  it("only the two terminal codes are treated as invalid", () => {
    expect([...ENGINE_SESSION_INVALID_ERRORS].sort())
      .toEqual(["session_epoch_missing", "session_invalidated"]);
  });
});

describe("isEngineProbeDue", () => {
  it("is due when never checked", () => expect(isEngineProbeDue(undefined, 1000, 60)).toBe(true));
  it("is not due inside the window", () => expect(isEngineProbeDue(1000, 1030, 60)).toBe(false));
  it("is due once the window elapses", () => expect(isEngineProbeDue(1000, 1060, 60)).toBe(true));
});

/* ── middleware: the teardown itself ────────────────────────────────────── */

describe("middleware — engine session reconciliation", () => {
  it("PRE-EPOCH session → cleared and redirected, with NO engine call", async () => {
    const res = await middleware(await requestWith(liveClaims({ jwtToken: PRE_EPOCH_JWT })));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("reason")).toBe("security_update");
    // The cookie is actively cleared, so the browser stops replaying it.
    expect(res.headers.get("set-cookie") ?? "").toMatch(/sl_session=;|sl_session=deleted|Max-Age=0/);
    // Decidable offline — the whole deploy blast radius costs zero requests.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("STALE epoch (password changed elsewhere) → cleared and redirected", async () => {
    vi.stubGlobal("fetch", engineAnswers(401, { error: "session_invalidated" }));
    const res = await middleware(await requestWith(liveClaims()));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("reason")).toBe("session_invalidated");
  });

  it("the redirect preserves where the user was going", async () => {
    const res = await middleware(await requestWith(liveClaims({ jwtToken: PRE_EPOCH_JWT }), "/findings?active=true"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("redirect")).toBe("/findings?active=true");
  });

  it("a LIVE session passes through untouched", async () => {
    const res = await middleware(await requestWith(liveClaims({ engineCheckedAt: NOW() })));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("a live session whose probe says 200 passes through", async () => {
    vi.stubGlobal("fetch", engineAnswers(200, { id: "u1" }));
    const res = await middleware(await requestWith(liveClaims()));
    expect(res.headers.get("location")).toBeNull();
  });

  it("a GENERIC 401 does NOT sign the user out", async () => {
    vi.stubGlobal("fetch", engineAnswers(401, { error: "invalid_or_expired_token" }));
    const res = await middleware(await requestWith(liveClaims()));
    expect(res.headers.get("location")).toBeNull();
  });

  it("an engine OUTAGE does not sign the whole customer base out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await middleware(await requestWith(liveClaims()));
    expect(res.headers.get("location")).toBeNull();
  });

  it("a legacy API-KEY session is never probed and never torn down", async () => {
    const now = NOW();
    const res = await middleware(
      await requestWith({ apiKey: "sl_live_abcdef123456", loginAt: now, lastActivityAt: now })
    );
    expect(res.headers.get("location")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the probe is throttled — a recent check means no second call", async () => {
    const res = await middleware(await requestWith(liveClaims({ engineCheckedAt: NOW() })));
    expect(res.headers.get("location")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("/login is public — the teardown redirect cannot loop", async () => {
    const req = new NextRequest(new URL("http://app.test/login?reason=security_update"));
    const res = await middleware(req);
    expect(res.headers.get("location")).toBeNull();
    // And with a stale cookie still attached, /login STILL does not redirect.
    const req2 = new NextRequest(new URL("http://app.test/login"));
    req2.cookies.set("sl_session", await sealSession(liveClaims({ jwtToken: PRE_EPOCH_JWT }), SECRET, 3600));
    expect((await middleware(req2)).headers.get("location")).toBeNull();
  });

  it("time-based expiry still reports its own reasons, not a session-invalidation one", async () => {
    const old = NOW() - 60 * 60 * 24;
    const res = await middleware(await requestWith({ jwtToken: EPOCH_JWT, loginAt: old, lastActivityAt: old }));
    const loc = new URL(res.headers.get("location")!);
    expect(["idle", "expired"]).toContain(loc.searchParams.get("reason"));
  });
});
