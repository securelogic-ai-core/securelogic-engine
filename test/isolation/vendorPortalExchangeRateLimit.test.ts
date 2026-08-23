/**
 * vendorPortalExchangeRateLimit.test.ts — VA-S1a.
 *
 * The unit suite proves the counting rules; this proves the WIRING: that the
 * limiter actually sits in front of the only endpoint an anonymous caller can
 * reach, over HTTP, on the real router, and that it charges the right thing.
 *
 * The strongest statement in here is the third case: once an address has burned
 * its failure budget, even a PERFECTLY VALID invite token gets a 429. That is
 * what makes it a limiter on the endpoint rather than a message the handler
 * prints after doing the work anyway.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import cookieParser from "cookie-parser";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import {
  generatePortalToken,
  hashPortalToken,
} from "../../src/api/lib/vendorPortal/portalTokens.js";
import {
  PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP,
  resetPortalExchangeLimiter,
} from "../../src/api/middleware/portalExchangeRateLimiter.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let liveToken: string;

const exchange = (token: unknown) =>
  request(app).post("/api/vendor-portal/session").send({ token });

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Rate limit vendor" });
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version)
     VALUES ($1, $2, 'initial', 'issued', '1.0.0', '1.0.0')
     RETURNING id`,
    [seed.orgA.id, vendorId]
  );
  liveToken = generatePortalToken();
  await pool.query(
    `INSERT INTO vendor_engagement_invites
       (organization_id, engagement_id, invite_token_hash, contact_email, expires_at)
     VALUES ($1, $2, $3, 'rate@vendor.example', $4)`,
    [
      seed.orgA.id,
      eng.rows[0]!.id,
      hashPortalToken(liveToken),
      new Date(Date.now() + 30 * 24 * 3600_000),
    ]
  );

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED;
  await pool?.end();
});

beforeEach(() => {
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  resetPortalExchangeLimiter();
});

describe("VA-S1a — the unauthenticated exchange is rate limited", () => {
  it("repeated bad tokens from one address end in 429, not an unbounded probe", async () => {
    let sawLimit = false;
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP + 1; i += 1) {
      const res = await exchange(`bogus-${i}`);
      if (res.status === 429) {
        sawLimit = true;
        expect(res.headers["retry-after"]).toBe("60");
        expect(res.body.error).toBe("rate_limit_exceeded");
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(sawLimit).toBe(true);
  });

  it("a valid link is NOT charged — a whole vendor office behind one address keeps working", async () => {
    for (let i = 0; i < PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP * 3; i += 1) {
      const res = await exchange(liveToken);
      expect(res.status).toBe(200);
    }
  });

  it("once the budget is burned, even a VALID token is refused — the gate is on the endpoint", async () => {
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP; i += 1) {
      await exchange(`bogus-${i}`);
    }
    const res = await exchange(liveToken);
    expect(res.status).toBe(429);
    // And the refusal still says nothing about the token — the limiter must not
    // become the oracle the exchange route is built not to be.
    expect(JSON.stringify(res.body)).not.toContain("invalid");
  });

  it("the kill switch still wins: flag OFF 404s before anything is counted", async () => {
    process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "false";
    for (let i = 0; i <= PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP + 2; i += 1) {
      const res = await exchange(`bogus-${i}`);
      expect(res.status).toBe(404);
    }
    process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
    // Nothing was charged while the portal was dark.
    expect((await exchange(liveToken)).status).toBe(200);
  });
});
