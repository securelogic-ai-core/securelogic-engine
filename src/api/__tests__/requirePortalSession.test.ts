/**
 * requirePortalSession.test.ts — the external principal resolver.
 *
 * This middleware is the only place an unauthenticated caller becomes a
 * principal, so its failure modes are the portal's failure modes. Every test
 * here is an adversarial one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  elevatedUsed: false,
  tenantUsed: false,
}));

vi.mock("../infra/postgres.js", () => ({
  pgElevated: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.elevatedUsed = true;
      h.queries.push({ sql, params });
      if (/SELECT/.test(sql)) return { rows: h.rows, rowCount: h.rows.length };
      return { rows: [], rowCount: 0 };
    }),
  },
  // If the resolver ever touches the TENANT channel it would see zero rows
  // post-flip, because org context does not exist yet — this spy proves it
  // does not.
  pg: {
    query: vi.fn(async () => {
      h.tenantUsed = true;
      return { rows: [], rowCount: 0 };
    }),
  },
  withTenant: vi.fn(async (_o: string, cb: () => Promise<unknown>) => cb()),
}));

import {
  PORTAL_RATE_LIMIT_PER_MINUTE,
  requirePortalSession,
  portalOwnsEngagement,
  type PortalRequest,
} from "../middleware/requirePortalSession.js";
import {
  PORTAL_SESSION_COOKIE,
  hashPortalToken,
} from "../lib/vendorPortal/portalTokens.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ENG_A = "22222222-2222-4222-8222-222222222222";
const RAW = "f".repeat(64);

const liveRow = (over: Record<string, unknown> = {}) => ({
  id: "sess-1",
  invite_id: "inv-1",
  organization_id: ORG_A,
  engagement_id: ENG_A,
  idle_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  absolute_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
  request_count: 0,
  window_started_at: new Date().toISOString(),
  created_user_agent_sha256: null,
  ...over,
});

function buildReq(over: Record<string, unknown> = {}): PortalRequest {
  return {
    cookies: { [PORTAL_SESSION_COOKIE]: RAW },
    headers: {},
    ip: "203.0.113.9",
    ...over,
  } as unknown as PortalRequest;
}

function buildRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status, json } as never, status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  h.queries = [];
  h.elevatedUsed = false;
  h.tenantUsed = false;
});

// ─── Resolution ─────────────────────────────────────────────────────────────

describe("portal session — resolution", () => {
  it("resolves org and engagement FROM THE ROW, and calls next", async () => {
    h.rows = [liveRow()];
    const req = buildReq();
    const { res } = buildRes();
    const next = vi.fn();

    await requirePortalSession(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.portalContext).toEqual({
      sessionId: "sess-1",
      inviteId: "inv-1",
      organizationId: ORG_A,
      engagementId: ENG_A,
    });
  });

  it("looks the session up by HASH, never by the raw cookie value", async () => {
    // A database read must never yield a usable credential, and the raw token
    // must not appear in a query the DB might log.
    h.rows = [liveRow()];
    await requirePortalSession(buildReq(), buildRes().res, vi.fn());

    const select = h.queries.find((q) => /SELECT/.test(q.sql))!;
    expect(select.params[0]).toBe(hashPortalToken(RAW));
    expect(select.params[0]).not.toBe(RAW);
    expect(JSON.stringify(h.queries)).not.toContain(RAW);
  });

  it("uses the ELEVATED channel — resolution PRECEDES org context", async () => {
    // The lookup is what establishes the org, so the tenant channel would see
    // zero rows post-flip. Same shape as the tokenized export download route.
    h.rows = [liveRow()];
    await requirePortalSession(buildReq(), buildRes().res, vi.fn());
    expect(h.elevatedUsed).toBe(true);
    expect(h.tenantUsed).toBe(false);
  });

  it("NEVER populates organizationContext — the two auth worlds stay disjoint", async () => {
    // A portal request that carried an organizationContext could reach normal
    // API routes. Structural disjointness is what prevents that.
    h.rows = [liveRow()];
    const req = buildReq();
    await requirePortalSession(req, buildRes().res, vi.fn());
    expect((req as { organizationContext?: unknown }).organizationContext).toBeUndefined();
  });

  it("STRIPS a pre-existing organizationContext rather than letting it ride along", async () => {
    h.rows = [liveRow()];
    const req = buildReq({ organizationContext: { organizationId: "some-other-org" } });
    await requirePortalSession(req, buildRes().res, vi.fn());
    expect((req as { organizationContext?: unknown }).organizationContext).toBeUndefined();
  });
});

// ─── Rejection ──────────────────────────────────────────────────────────────

describe("portal session — every rejection is uniform and fails closed", () => {
  const expectRejected = async (req: PortalRequest) => {
    const { res, status, json } = buildRes();
    const next = vi.fn();
    await requirePortalSession(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "portal_session_invalid" });
  };

  it("no cookie", async () => {
    await expectRejected(buildReq({ cookies: {} }));
  });

  it("empty cookie", async () => {
    await expectRejected(buildReq({ cookies: { [PORTAL_SESSION_COOKIE]: "" } }));
  });

  it("cookies object entirely absent", async () => {
    await expectRejected(buildReq({ cookies: undefined }));
  });

  it("unknown token", async () => {
    h.rows = [];
    await expectRejected(buildReq());
  });

  it("revoked session — the kill switch takes effect immediately", async () => {
    h.rows = [liveRow({ revoked_at: new Date().toISOString() })];
    await expectRejected(buildReq());
  });

  it("idle-expired session", async () => {
    h.rows = [liveRow({ idle_expires_at: new Date(Date.now() - 1000).toISOString() })];
    await expectRejected(buildReq());
  });

  it("absolute-expired session, even with a fresh idle window", async () => {
    h.rows = [
      liveRow({
        idle_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        absolute_expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ];
    await expectRejected(buildReq());
  });

  it("a database error fails CLOSED, never through to the handler", async () => {
    const { pgElevated } = await import("../infra/postgres.js");
    (pgElevated.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    await expectRejected(buildReq());
  });

  it("every rejection returns the IDENTICAL body — no oracle", async () => {
    // Distinguishing "revoked" from "never existed" would tell an attacker
    // whether a captured cookie was ever real.
    const bodies: unknown[] = [];
    for (const rows of [
      [],
      [liveRow({ revoked_at: new Date().toISOString() })],
      [liveRow({ idle_expires_at: new Date(Date.now() - 1).toISOString() })],
    ]) {
      h.rows = rows as Array<Record<string, unknown>>;
      const { res, json } = buildRes();
      await requirePortalSession(buildReq(), res, vi.fn());
      bodies.push(json.mock.calls[0]?.[0]);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
});

// ─── Rate limiting ──────────────────────────────────────────────────────────

describe("portal session — rate limiting survives a Redis outage", () => {
  it("429s past the per-minute limit, from the DATABASE counter", async () => {
    // apiRateLimiter.ts fails OPEN when Redis is down. That is unacceptable on
    // an unauthenticated surface, so the counter lives on the session row.
    h.rows = [liveRow({ request_count: PORTAL_RATE_LIMIT_PER_MINUTE })];
    const { res, status, json } = buildRes();
    const next = vi.fn();

    await requirePortalSession(buildReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
    expect(json.mock.calls[0]![0]).toMatchObject({ error: "rate_limit_exceeded" });
  });

  it("allows the request that exactly reaches the limit", async () => {
    h.rows = [liveRow({ request_count: PORTAL_RATE_LIMIT_PER_MINUTE - 1 })];
    const next = vi.fn();
    await requirePortalSession(buildReq(), buildRes().res, next);
    expect(next).toHaveBeenCalled();
  });

  it("resets once the window has rolled, rather than locking the session out", async () => {
    h.rows = [
      liveRow({
        request_count: PORTAL_RATE_LIMIT_PER_MINUTE * 10,
        window_started_at: new Date(Date.now() - 120_000).toISOString(),
      }),
    ];
    const next = vi.fn();
    await requirePortalSession(buildReq(), buildRes().res, next);
    expect(next).toHaveBeenCalled();
  });

  it("uses NO Redis at all", async () => {
    h.rows = [liveRow()];
    await requirePortalSession(buildReq(), buildRes().res, vi.fn());
    expect(JSON.stringify(h.queries)).not.toMatch(/redis/i);
  });
});

// ─── Session upkeep ─────────────────────────────────────────────────────────

describe("portal session — upkeep on each request", () => {
  it("slides the idle window and records last-seen in one write", async () => {
    h.rows = [liveRow()];
    await requirePortalSession(buildReq(), buildRes().res, vi.fn());
    const update = h.queries.find((q) => /UPDATE vendor_portal_sessions/.test(q.sql))!;
    expect(update.sql).toMatch(/idle_expires_at = \$2/);
    expect(update.sql).toMatch(/last_seen_at = NOW\(\)/);
    expect(update.sql).toMatch(/request_count = \$4/);
  });

  it("FLAGS a changed user agent but does not block on it", async () => {
    // Vendors legitimately switch devices mid-questionnaire. Blocking would lock
    // out honest users while barely inconveniencing someone holding the cookie.
    h.rows = [liveRow({ created_user_agent_sha256: hashPortalToken("original-ua") })];
    const next = vi.fn();
    await requirePortalSession(
      buildReq({ headers: { "user-agent": "a completely different browser" } }),
      buildRes().res,
      next
    );
    expect(next).toHaveBeenCalled();
    const update = h.queries.find((q) => /UPDATE vendor_portal_sessions/.test(q.sql))!;
    expect(update.sql).toMatch(/fingerprint_changed_at/);
    expect(update.params[5]).toBe(true);
  });

  it("does not flag when the user agent is unchanged", async () => {
    const ua = "same-browser";
    h.rows = [liveRow({ created_user_agent_sha256: hashPortalToken(ua) })];
    await requirePortalSession(buildReq({ headers: { "user-agent": ua } }), buildRes().res, vi.fn());
    const update = h.queries.find((q) => /UPDATE vendor_portal_sessions/.test(q.sql))!;
    expect(update.params[5]).toBe(false);
  });
});

// ─── Ownership helper ───────────────────────────────────────────────────────

describe("portal session — engagement ownership", () => {
  it("matches only the session's own engagement", () => {
    const req = { portalContext: { engagementId: ENG_A } } as PortalRequest;
    expect(portalOwnsEngagement(req, ENG_A)).toBe(true);
    expect(portalOwnsEngagement(req, "33333333-3333-4333-8333-333333333333")).toBe(false);
  });

  it("returns false when there is no portal context at all", () => {
    expect(portalOwnsEngagement({} as PortalRequest, ENG_A)).toBe(false);
  });
});
