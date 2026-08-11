import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

/**
 * The identity that `adminLockout` and `adminRateLimit` ENFORCE against.
 *
 * These two are the admin controls that actually reject traffic (429 / 503), so
 * the address they count against is load-bearing in a way the dark allowlist's
 * was not. Both previously keyed on `req.ip`, which behind Render's Cloudflare
 * edge is a CDN node rather than the caller. That produced two concrete defects,
 * and each has a test below that FAILS against the old `req.ip` behaviour:
 *
 *   1. COLLATERAL LOCKOUT — distinct clients sharing one Cloudflare PoP shared a
 *      single failure counter, so one abuser could lock out every legitimate
 *      admin behind that PoP. ("shared edge" tests)
 *   2. TRIVIAL EVASION — the edge address rotates between requests for one
 *      client (measured live: 172.70.134.76 then 172.71.190.23 for a client at
 *      172.191.151.49), so a brute-forcer earned a fresh allowance as PoPs
 *      rotated. ("rotation" tests)
 *
 * Thresholds and windows are deliberately re-asserted here: this change was
 * scoped to the identity only, and these tests are what pin that.
 */

vi.mock("../infra/redis.js", () => ({
  redisReady: true,
  ensureRedisConnected: vi.fn()
}));

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import {
  resolveThrottleIdentity,
  UNRESOLVED_THROTTLE_KEY
} from "../infra/clientIp.js";
import { adminLockout, recordAdminAuthFailure } from "../middleware/adminLockout.js";
import { adminRateLimit } from "../middleware/adminRateLimit.js";
import * as redisModule from "../infra/redis.js";

const mockedEnsure = vi.mocked(redisModule.ensureRedisConnected);

/** A request as Express would present it: `ip` is the edge, headers carry the truth. */
const req = (ip: string | undefined, headers: Record<string, unknown> = {}) =>
  ({ ip, headers, originalUrl: "/admin/organizations", method: "GET" }) as unknown as Request;

/** Minimal in-memory Redis recording exactly which keys were touched. */
function fakeRedis() {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    store,
    counters,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    }),
    incr: vi.fn(async (k: string) => {
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      return n;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (k: string) => {
      counters.delete(k);
      return 1;
    })
  };
}

let redis: ReturnType<typeof fakeRedis>;

beforeEach(() => {
  redis = fakeRedis();
  mockedEnsure.mockReset();
  mockedEnsure.mockResolvedValue(redis as never);
});

const runMw = async (
  mw: (r: Request, s: Response, n: NextFunction) => unknown,
  r: Request
) => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    }
  };
  let nexted = false;
  await mw(r, res as unknown as Response, (() => {
    nexted = true;
  }) as NextFunction);
  return { res, nexted };
};

// ---------------------------------------------------------------------------
// resolveThrottleIdentity — the identity itself
// ---------------------------------------------------------------------------

describe("resolveThrottleIdentity", () => {
  it("keys on the true client behind Cloudflare, not the edge node", () => {
    const id = resolveThrottleIdentity(
      req("172.70.134.76", { "cf-connecting-ip": "172.191.151.49" })
    );
    expect(id.key).toBe("172.191.151.49");
    expect(id.source).toBe("cloudflare");
    // The defect in one line: the edge address must not be what gets counted.
    expect(id.key).not.toBe("172.70.134.76");
  });

  it("keys on req.ip when there is no proxy at all (direct / local / tests)", () => {
    const id = resolveThrottleIdentity(req("203.0.113.7"));
    expect(id.key).toBe("203.0.113.7");
    expect(id.source).toBe("express");
  });

  it("ignores a malformed CF-Connecting-IP rather than keying on garbage", () => {
    const id = resolveThrottleIdentity(
      req("172.70.134.76", { "cf-connecting-ip": "not-an-ip" })
    );
    expect(id.key).toBe("172.70.134.76");
    expect(id.source).toBe("express");
  });

  it("refuses a comma-joined CF-Connecting-IP instead of guessing an element", () => {
    // A forged header is rejected at the Cloudflare edge (403/1000, verified live),
    // but the parser must not guess even if one ever arrived.
    const id = resolveThrottleIdentity(
      req("172.70.134.76", { "cf-connecting-ip": "1.2.3.4, 172.191.151.49" })
    );
    expect(id.key).toBe("172.70.134.76");
    expect(id.source).toBe("express");
  });

  it("refuses a duplicated CF-Connecting-IP header (array form)", () => {
    const id = resolveThrottleIdentity(
      req("172.70.134.76", { "cf-connecting-ip": ["1.2.3.4", "172.191.151.49"] })
    );
    expect(id.key).toBe("172.70.134.76");
    expect(id.source).toBe("express");
  });

  it("does not let a spoofed X-Forwarded-For change the key", () => {
    // trust proxy = 1 means Express already resolved req.ip; XFF is never re-parsed here.
    const id = resolveThrottleIdentity(
      req("172.70.134.76", {
        "x-forwarded-for": "20.42.11.16",
        "cf-connecting-ip": "172.191.151.49"
      })
    );
    expect(id.key).toBe("172.191.151.49");
  });

  it("collapses unresolvable callers onto ONE shared bucket, never a private one", () => {
    const a = resolveThrottleIdentity(req(undefined));
    const b = resolveThrottleIdentity(req(undefined, { "cf-connecting-ip": "???" }));
    expect(a.key).toBe(UNRESOLVED_THROTTLE_KEY);
    expect(b.key).toBe(UNRESOLVED_THROTTLE_KEY);
    // The fail-safe direction: unresolvable callers throttle each other, rather
    // than each receiving a fresh allowance.
    expect(a.key).toBe(b.key);
  });

  it("never yields a null or 'undefined' key", () => {
    const id = resolveThrottleIdentity(req(undefined));
    expect(id.key).toBeTruthy();
    expect(id.key).not.toBe("undefined");
  });

  it("normalises IPv4-mapped IPv6 so one client is one bucket across forms", () => {
    const mapped = resolveThrottleIdentity(
      req("172.70.134.76", { "cf-connecting-ip": "::ffff:172.191.151.49" })
    );
    const plain = resolveThrottleIdentity(
      req("172.70.134.76", { "cf-connecting-ip": "172.191.151.49" })
    );
    expect(mapped.key).toBe(plain.key);
  });
});

// ---------------------------------------------------------------------------
// adminLockout — collateral lockout and evasion
// ---------------------------------------------------------------------------

describe("adminLockout identity", () => {
  it("gives two clients on the SAME Cloudflare edge separate counters", async () => {
    // Pre-fix both would have keyed on 172.70.134.76 and shared one counter.
    const shared = "172.70.134.76";
    await runMw(adminLockout, req(shared, { "cf-connecting-ip": "172.191.151.49" }));
    await runMw(adminLockout, req(shared, { "cf-connecting-ip": "20.42.11.16" }));

    expect(redis.get).toHaveBeenCalledWith("admin:lockout:172.191.151.49");
    expect(redis.get).toHaveBeenCalledWith("admin:lockout:20.42.11.16");
    expect(redis.get).not.toHaveBeenCalledWith(`admin:lockout:${shared}`);
  });

  it("does not let an abuser lock out a co-located admin", async () => {
    const shared = "172.70.134.76";
    const abuser = req(shared, { "cf-connecting-ip": "198.51.100.99" });
    for (let i = 0; i < 5; i++) await recordAdminAuthFailure(abuser);

    // Abuser is locked...
    expect(redis.store.get("admin:lockout:198.51.100.99")).toBe("1");
    // ...the innocent admin sharing that PoP is not.
    expect(redis.store.has("admin:lockout:172.191.151.49")).toBe(false);

    const victim = await runMw(
      adminLockout,
      req(shared, { "cf-connecting-ip": "172.191.151.49" })
    );
    expect(victim.nexted).toBe(true);
    expect(victim.res.statusCode).toBe(200);
  });

  it("follows one client across ROTATING edge nodes into a single counter", async () => {
    // The measured rotation: same caller, different PoP each request.
    const client = "172.191.151.49";
    for (const edge of ["172.70.134.76", "172.71.190.23", "104.22.100.27"]) {
      await recordAdminAuthFailure(req(edge, { "cf-connecting-ip": client }));
    }
    // Pre-fix this was three counters of 1. Now it is one counter of 3.
    expect(redis.counters.get(`admin:failures:${client}`)).toBe(3);
    expect(redis.counters.size).toBe(1);
  });

  it("still locks out after exactly MAX_FAILURES (threshold unchanged)", async () => {
    const r = req("172.70.134.76", { "cf-connecting-ip": "198.51.100.99" });
    for (let i = 0; i < 4; i++) await recordAdminAuthFailure(r);
    expect(redis.store.has("admin:lockout:198.51.100.99")).toBe(false);

    await recordAdminAuthFailure(r);
    expect(redis.store.get("admin:lockout:198.51.100.99")).toBe("1");
  });

  it("blocks a locked-out client with 429, semantics unchanged", async () => {
    redis.store.set("admin:lockout:172.191.151.49", "1");
    const { res, nexted } = await runMw(
      adminLockout,
      req("172.70.134.76", { "cf-connecting-ip": "172.191.151.49" })
    );
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "too_many_requests", reason: "admin_lockout" });
  });

  it("still exposes the lockout context requireAdminKey depends on", async () => {
    const r = req("172.70.134.76", { "cf-connecting-ip": "172.191.151.49" });
    await runMw(adminLockout, r);
    expect((r as any).adminLockout).toEqual({
      ip: "172.191.151.49",
      lockKey: "admin:lockout:172.191.151.49",
      failKey: "admin:failures:172.191.151.49"
    });
  });

  it("counts unresolvable callers together rather than giving each a free pass", async () => {
    await recordAdminAuthFailure(req(undefined));
    await recordAdminAuthFailure(req(undefined));
    expect(redis.counters.get(`admin:failures:${UNRESOLVED_THROTTLE_KEY}`)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// adminRateLimit
// ---------------------------------------------------------------------------

describe("adminRateLimit identity", () => {
  it("keys on the true client, not the edge", async () => {
    await runMw(adminRateLimit, req("172.70.134.76", { "cf-connecting-ip": "172.191.151.49" }));
    expect(redis.incr).toHaveBeenCalledWith("admin:rate:172.191.151.49");
  });

  it("does not pool distinct clients behind one edge into a shared budget", async () => {
    const shared = "172.70.134.76";
    await runMw(adminRateLimit, req(shared, { "cf-connecting-ip": "172.191.151.49" }));
    await runMw(adminRateLimit, req(shared, { "cf-connecting-ip": "20.42.11.16" }));
    expect(redis.counters.get("admin:rate:172.191.151.49")).toBe(1);
    expect(redis.counters.get("admin:rate:20.42.11.16")).toBe(1);
  });

  it("does not hand a rotating caller a fresh budget per PoP", async () => {
    const client = "198.51.100.99";
    for (const edge of ["172.70.134.76", "172.71.190.23"]) {
      await runMw(adminRateLimit, req(edge, { "cf-connecting-ip": client }));
    }
    expect(redis.counters.get(`admin:rate:${client}`)).toBe(2);
    expect(redis.counters.size).toBe(1);
  });

  it("never produces the literal key admin:rate:undefined", async () => {
    await runMw(adminRateLimit, req(undefined));
    expect(redis.incr).not.toHaveBeenCalledWith("admin:rate:undefined");
    expect(redis.incr).toHaveBeenCalledWith(`admin:rate:${UNRESOLVED_THROTTLE_KEY}`);
  });

  it("still 429s past MAX_REQUESTS and not before (threshold unchanged)", async () => {
    const r = req("172.70.134.76", { "cf-connecting-ip": "172.191.151.49" });
    redis.counters.set("admin:rate:172.191.151.49", 299);

    const at300 = await runMw(adminRateLimit, r);
    expect(at300.nexted).toBe(true);

    const at301 = await runMw(adminRateLimit, r);
    expect(at301.nexted).toBe(false);
    expect(at301.res.statusCode).toBe(429);
    expect(at301.res.body).toEqual({ error: "rate_limit_exceeded" });
  });

  it("sets the window only on the first request in it", async () => {
    const r = req("172.70.134.76", { "cf-connecting-ip": "172.191.151.49" });
    await runMw(adminRateLimit, r);
    await runMw(adminRateLimit, r);
    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis.expire).toHaveBeenCalledWith("admin:rate:172.191.151.49", 60);
  });
});
