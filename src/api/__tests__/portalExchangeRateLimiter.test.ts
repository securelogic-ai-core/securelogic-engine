/**
 * portalExchangeRateLimiter.test.ts — VA-S1a.
 *
 * The exchange is the only endpoint an anonymous caller can make do work, and
 * until this middleware existed it had no limit of any kind. What is asserted
 * here is the SHAPE of the limit, because the shape is the product decision:
 * failures are charged to an address, successes are free, and a global ceiling
 * catches the spray that no per-address rule can see.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

vi.mock("../infra/redis.js", () => ({
  redisReady: false,
  ensureRedisConnected: vi.fn(),
}));

import {
  PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP,
  PORTAL_EXCHANGE_LIMIT_GLOBAL,
  checkExchangeAttempt,
  portalExchangeRateLimiter,
  recordExchangeFailure,
  resetPortalExchangeLimiter,
} from "../middleware/portalExchangeRateLimiter.js";

const T0 = 1_700_000_000_000;

function buildRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const setHeader = vi.fn();
  return { res: { status, json, setHeader } as unknown as Response, status, json, setHeader };
}

beforeEach(() => {
  resetPortalExchangeLimiter();
});

describe("portal exchange limiter — successes are free", () => {
  it("admits far more successful exchanges than the failure limit", () => {
    // A vendor office behind one NAT address. Charging success would break the
    // honest case and barely inconvenience anyone else.
    for (let i = 0; i < PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP * 5; i += 1) {
      expect(checkExchangeAttempt("198.51.100.7", T0).allowed).toBe(true);
    }
  });
});

describe("portal exchange limiter — failures are charged to the address", () => {
  it("shuts the address out once it exceeds the failure budget", () => {
    const ip = "203.0.113.5";
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP; i += 1) {
      expect(checkExchangeAttempt(ip, T0).allowed).toBe(true);
      recordExchangeFailure(ip, T0);
    }
    const decision = checkExchangeAttempt(ip, T0);
    expect(decision).toEqual({ allowed: false, scope: "ip" });
  });

  it("charges ONLY the failing address — a neighbour is unaffected", () => {
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP; i += 1) {
      recordExchangeFailure("203.0.113.6", T0);
    }
    expect(checkExchangeAttempt("203.0.113.6", T0).allowed).toBe(false);
    expect(checkExchangeAttempt("198.51.100.9", T0).allowed).toBe(true);
  });

  it("forgets the address when the window rolls — a limiter, not a ban list", () => {
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP; i += 1) {
      recordExchangeFailure("203.0.113.7", T0);
    }
    expect(checkExchangeAttempt("203.0.113.7", T0).allowed).toBe(false);
    expect(checkExchangeAttempt("203.0.113.7", T0 + 60_000).allowed).toBe(true);
  });
});

describe("portal exchange limiter — the global ceiling catches the spray", () => {
  it("refuses once the process-wide attempt ceiling is passed, whatever the address", () => {
    for (let i = 0; i < PORTAL_EXCHANGE_LIMIT_GLOBAL; i += 1) {
      expect(checkExchangeAttempt(`10.0.0.${i % 255}`, T0).allowed).toBe(true);
    }
    // A brand-new address with a clean failure record still gets nothing.
    expect(checkExchangeAttempt("192.0.2.200", T0)).toEqual({ allowed: false, scope: "global" });
  });
});

describe("portal exchange limiter — middleware behaviour", () => {
  it("passes a clean caller through", async () => {
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = buildRes();
    await portalExchangeRateLimiter({ ip: "198.51.100.1" } as Request, res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After and NO hint about the token", async () => {
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP; i += 1) {
      recordExchangeFailure("198.51.100.2");
    }
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json, setHeader } = buildRes();
    await portalExchangeRateLimiter({ ip: "198.51.100.2" } as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "60");
    // Not "invalid token", not "revoked": the limiter must not become the
    // oracle the exchange route is built not to be.
    expect(json).toHaveBeenCalledWith({
      error: "rate_limit_exceeded",
      message: "Too many requests. Please wait a moment and try again.",
    });
  });

  it("a missing address is still counted, under one bucket", async () => {
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP; i += 1) {
      recordExchangeFailure("unknown");
    }
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = buildRes();
    await portalExchangeRateLimiter({} as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
  });

  it("does not fail OPEN when Redis is unavailable — the in-process floor stands", async () => {
    // apiRateLimiter.ts calls next() when redisReady is false. On a public
    // endpoint that would mean no limit at all, so this one never consults
    // Redis for permission — only for a stricter shared opinion.
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP; i += 1) {
      recordExchangeFailure("198.51.100.3");
    }
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = buildRes();
    await portalExchangeRateLimiter({ ip: "198.51.100.3" } as Request, res, next);
    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});
