import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { resolveClientIp } from "../infra/clientIp.js";

/**
 * resolveClientIp — which address a security control is allowed to act on.
 *
 * The `source` field is the contract that matters. Behind Render's Cloudflare
 * edge, `req.ip` is a CDN node whose value rotates between requests (measured
 * live: 172.70.134.76 then 172.71.190.23 for one client at 172.191.151.49).
 * A caller must be able to distinguish "this is the real caller" from "this is
 * whatever Express had", because allowlisting the latter grants access to
 * everyone sharing that PoP.
 */

const req = (ip: string | undefined, headers: Record<string, unknown> = {}) =>
  ({ ip, headers }) as unknown as Request;

describe("resolveClientIp", () => {
  it("prefers CF-Connecting-IP and says so", () => {
    expect(resolveClientIp(req("172.70.134.76", { "cf-connecting-ip": "20.42.11.16" })))
      .toEqual({ ip: "20.42.11.16", source: "cloudflare", expressIp: "172.70.134.76" });
  });

  it("falls back to req.ip and flags the weaker source", () => {
    expect(resolveClientIp(req("172.70.134.76"))).toEqual({
      ip: "172.70.134.76",
      source: "express",
      expressIp: "172.70.134.76"
    });
  });

  it("always reports expressIp, so a fix can be proven after rollout", () => {
    const r = resolveClientIp(req("172.70.134.76", { "cf-connecting-ip": "20.42.11.16" }));
    expect(r.expressIp).toBe("172.70.134.76");
    expect(r.ip).not.toBe(r.expressIp);
  });

  it("normalises IPv4-mapped IPv6 so allowlist comparison works", () => {
    expect(resolveClientIp(req(undefined, { "cf-connecting-ip": "::ffff:20.42.11.16" })).ip)
      .toBe("20.42.11.16");
  });

  it("rejects a multi-valued header instead of picking an entry", () => {
    const r = resolveClientIp(req("172.70.134.76", { "cf-connecting-ip": "1.2.3.4, 5.6.7.8" }));
    expect(r.source).toBe("express");
  });

  it("rejects a repeated header (array form)", () => {
    const r = resolveClientIp(req("172.70.134.76", { "cf-connecting-ip": ["1.2.3.4", "5.6.7.8"] }));
    expect(r.source).toBe("express");
  });

  it("rejects malformed and oversized values", () => {
    for (const bad of ["not-an-ip", "", "   ", "999.999.999.999", "1".repeat(200)]) {
      expect(resolveClientIp(req(undefined, { "cf-connecting-ip": bad })))
        .toEqual({ ip: null, source: "none", expressIp: null });
    }
  });

  it("returns source 'none' when there is nothing usable at all", () => {
    expect(resolveClientIp(req(undefined))).toEqual({
      ip: null,
      source: "none",
      expressIp: null
    });
  });
});
