/**
 * rateLimitClientIdentity.test.ts — rate-limit client-identity package
 * (2026-08-17): the ENFORCING twin of the Tier-2 telemetry fix.
 *
 * Proves, over a REAL express-rate-limit limiter mounted with the production
 * trust-proxy shape, the operator-required behaviors:
 *   1. one client traversing ROTATING Cloudflare edges consumes ONE budget;
 *   2. two distinct clients keep INDEPENDENT budgets;
 *   3. spoofed/duplicated forwarding headers cannot manufacture identities;
 *   4. off-Cloudflare (no CF header) falls back to req.ip;
 *   5. unresolved callers share the single fallback bucket;
 *   6. thresholds/windows of every converted limiter are UNCHANGED
 *      (source-pinned so a keying PR cannot smuggle a threshold change);
 *   7. IPv6 callers bucket per /56 via express-rate-limit's own helper, so a
 *      delegated prefix cannot mint per-address budgets.
 */

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import { rateLimitKeyGenerator, UNRESOLVED_THROTTLE_KEY } from "../infra/clientIp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function makeApp(max: number): express.Express {
  const app = express();
  app.set("trust proxy", 1); // production shape (app.ts)
  app.get(
    "/limited",
    rateLimit({ windowMs: 60 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, keyGenerator: rateLimitKeyGenerator }),
    (_req, res) => res.status(200).json({ ok: true })
  );
  return app;
}

const EDGES = ["172.70.134.76", "172.71.190.23", "172.68.11.5", "172.69.42.9"];

async function hit(app: express.Express, client: string | null, edge: string, cfOverride?: string | string[]): Promise<number> {
  let r = request(app).get("/limited").set("X-Forwarded-For", `${client ?? "10.0.0.9"}, ${edge}`);
  if (cfOverride !== undefined) {
    r = (r as unknown as { set(k: string, v: string | string[]): typeof r }).set("CF-Connecting-IP", cfOverride);
  } else if (client) {
    r = r.set("CF-Connecting-IP", client);
  }
  const res = await r;
  return res.status;
}

describe("rate-limit client identity", () => {
  it("(1) one client through rotating edges consumes ONE shared budget — 429 exactly at threshold", async () => {
    const app = makeApp(3);
    const statuses: number[] = [];
    for (const edge of EDGES) statuses.push(await hit(app, "203.0.113.50", edge));
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("(2) two distinct clients keep independent budgets", async () => {
    const app = makeApp(2);
    expect(await hit(app, "203.0.113.50", EDGES[0])).toBe(200);
    expect(await hit(app, "203.0.113.50", EDGES[1])).toBe(200);
    expect(await hit(app, "203.0.113.50", EDGES[2])).toBe(429); // A exhausted
    expect(await hit(app, "198.51.100.7", EDGES[2])).toBe(200); // B unaffected
  });

  it("(3) a comma-list CF header cannot mint identities — such callers share the edge-derived bucket", async () => {
    const app = makeApp(2);
    // Attacker varies the forged half of a comma list each time; identity
    // degrades to req.ip (the SAME edge), so the budget is shared and exhausts.
    const s1 = await hit(app, null, EDGES[0], "6.6.6.1, 9.9.9.9");
    const s2 = await hit(app, null, EDGES[0], "6.6.6.2, 9.9.9.9");
    const s3 = await hit(app, null, EDGES[0], "6.6.6.3, 9.9.9.9");
    expect([s1, s2, s3]).toEqual([200, 200, 429]);
  });

  it("(3b) a duplicated CF header is rejected the same way", async () => {
    const app = makeApp(1);
    expect(await hit(app, null, EDGES[0], ["6.6.6.6", "7.7.7.7"])).toBe(200);
    expect(await hit(app, null, EDGES[0], ["8.8.8.8", "9.9.9.9"])).toBe(429); // same edge bucket
  });

  it("(4) off-Cloudflare: no CF header → keyed by req.ip, distinct addresses stay distinct", async () => {
    const app = makeApp(1);
    expect(await hit(app, null, EDGES[0])).toBe(200);
    expect(await hit(app, null, EDGES[0])).toBe(429); // same req.ip bucket
    expect(await hit(app, null, EDGES[1])).toBe(200); // different req.ip = own budget
  });

  it("(5) unresolved callers collapse onto the single shared bucket", () => {
    const fakeReq = (ip: unknown): express.Request =>
      ({ ip, headers: {} }) as unknown as express.Request;
    expect(rateLimitKeyGenerator(fakeReq(undefined))).toBe(UNRESOLVED_THROTTLE_KEY);
    expect(rateLimitKeyGenerator(fakeReq("not-an-ip"))).toBe(UNRESOLVED_THROTTLE_KEY);
    // identical key for every unresolvable caller — never a private allowance
    expect(rateLimitKeyGenerator(fakeReq(undefined))).toBe(rateLimitKeyGenerator(fakeReq("also-bad")));
  });

  it("(7) IPv6 callers bucket per /56 (a delegated prefix cannot mint budgets)", () => {
    const fakeReq = (cf: string): express.Request =>
      ({ ip: "172.70.1.1", headers: { "cf-connecting-ip": cf } }) as unknown as express.Request;
    const a = rateLimitKeyGenerator(fakeReq("2001:db8:aa:1::1"));
    const b = rateLimitKeyGenerator(fakeReq("2001:db8:aa:2::9"));
    const c = rateLimitKeyGenerator(fakeReq("2001:db8:bb:1::1"));
    expect(a).toBe(b);     // same /56
    expect(a).not.toBe(c); // different /56
    expect(a).toBe(ipKeyGenerator("2001:db8:aa:1::1")); // exactly the library's bucketing
  });
});

// ---------------------------------------------------------------------------
// (6) thresholds/windows source-pinned — the keying package must not move them
// ---------------------------------------------------------------------------

const PINNED: Record<string, Array<{ windowMs: string; max: number }>> = {
  "../app.ts": [
    { windowMs: "60_000", max: 300 },  // global limiter
    { windowMs: "60_000", max: 200 }   // stripe webhook limiter
  ],
  "../routes/customerAuth.ts": [
    { windowMs: "60 * 60 * 1000", max: 5 },   // signup
    { windowMs: "15 * 60 * 1000", max: 10 },  // login
    { windowMs: "60 * 60 * 1000", max: 3 },   // forgot-password
    { windowMs: "60 * 1000", max: 10 }        // verify
  ]
};

describe("(6) converted limiters keep their thresholds/windows", () => {
  for (const [file, limiters] of Object.entries(PINNED)) {
    it(`${file} — ${limiters.length} limiter(s) unchanged and keyed`, () => {
      const src = readFileSync(path.resolve(HERE, file), "utf8");
      const blocks = src.match(/rateLimit\(\{[\s\S]*?keyGenerator: rateLimitKeyGenerator,[\s\S]*?\}\)/g) ?? [];
      expect(blocks.length).toBeGreaterThanOrEqual(limiters.length);
      for (const expected of limiters) {
        const found = blocks.some(
          b => b.includes(`windowMs: ${expected.windowMs}`) && new RegExp(`max:\\s*${expected.max}\\b`).test(b)
        );
        expect(found, `expected a keyed limiter with windowMs=${expected.windowMs} max=${expected.max} in ${file}`).toBe(true);
      }
    });
  }
});
