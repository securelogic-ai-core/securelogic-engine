/**
 * vendorPortalAdversarial.test.ts — Stop Gate B evidence for the routes that
 * exist today (session exchange, sign-out, engagement read).
 *
 * The portal is the first unauthenticated write path in the platform that
 * touches tenant data, so this suite is written from the attacker's side: every
 * test is something someone would actually try.
 *
 * Run against a real Postgres with RLS enabled, because the properties under
 * test are database-layer ones. A mocked cross-tenant probe proves nothing.
 *
 * NOTE ON COVERAGE: the questionnaire, evidence-upload and comment routes are
 * not built yet, so their IDOR and upload-abuse cases are not here. This file
 * covers the credential boundary; Stop Gate B is not passed until the remaining
 * routes land with their own adversarial cases.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import {
  hashPortalToken,
  generatePortalToken,
  PORTAL_SESSION_COOKIE,
} from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

/** Raw invite tokens per org — these are what a vendor receives by email. */
const tokens: Record<string, string> = {};
const engagements: Record<string, string> = {};

async function seedEngagementWithInvite(
  orgId: string,
  label: string,
  opts: { expiresInMs?: number; revoked?: boolean } = {}
): Promise<{ engagementId: string; token: string }> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status, methodology_version, scope_rule_version, title)
     VALUES ($1, $2, 'initial', 'issued', '1.0.0', '1.0.0', $3)
     RETURNING id`,
    [orgId, vendorId, `${label} engagement`]
  );
  const engagementId = eng.rows[0]!.id;

  const token = generatePortalToken();
  await pool.query(
    `INSERT INTO vendor_engagement_invites
       (organization_id, engagement_id, invite_token_hash, contact_email,
        expires_at, revoked_at, revocation_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orgId,
      engagementId,
      hashPortalToken(token),
      `${label}@example.com`,
      new Date(Date.now() + (opts.expiresInMs ?? 30 * 24 * 3600_000)),
      opts.revoked ? new Date() : null,
      opts.revoked ? "revoked for test" : null,
    ]
  );
  return { engagementId, token };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the portal adversarial test.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const a = await seedEngagementWithInvite(seed.orgA.id, "ORG-A-PORTAL");
  const b = await seedEngagementWithInvite(seed.orgB.id, "ORG-B-SECRET");
  tokens.a = a.token;
  tokens.b = b.token;
  engagements.a = a.engagementId;
  engagements.b = b.engagementId;

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(() => {
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
});

/** Exchange an invite token and return the session cookie. */
async function sessionCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
  expect(res.status, `exchange failed: ${JSON.stringify(res.body)}`).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE));
  expect(cookie, "no portal cookie was set").toBeTruthy();
  return cookie!.split(";")[0]!;
}

// ─── The exchange ───────────────────────────────────────────────────────────

describe("Stop Gate B — invite exchange", () => {
  it("a valid invite yields a session, and the raw token is NEVER echoed", async () => {
    const res = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    expect(res.status).toBe(200);
    // The secret lives only in the cookie. Echoing it would put it back in a
    // place the client might log or render — the exact thing the exchange exists
    // to prevent.
    expect(JSON.stringify(res.body)).not.toContain(tokens.a!);
    expect(res.body).toEqual({ ok: true });
  });

  it("the cookie is httpOnly and PATH-SCOPED to the portal", async () => {
    const res = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith(PORTAL_SESSION_COOKIE)
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/vendor-portal/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("the cookie value is NOT the invite token", async () => {
    const cookie = await sessionCookie(tokens.a!);
    expect(cookie).not.toContain(tokens.a!);
  });

  it("an unknown token is refused", async () => {
    const res = await request(app)
      .post("/api/vendor-portal/session")
      .send({ token: generatePortalToken() });
    expect(res.status).toBe(401);
  });

  it("a malformed / missing token is refused without a stack trace", async () => {
    for (const body of [{}, { token: "" }, { token: 123 }, { token: null }]) {
      const res = await request(app).post("/api/vendor-portal/session").send(body);
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object|node_modules/i);
    }
  });

  it("a REVOKED invite is refused, indistinguishably from an unknown one", async () => {
    const revoked = await seedEngagementWithInvite(seed.orgA.id, "REVOKED", { revoked: true });
    const res = await request(app).post("/api/vendor-portal/session").send({ token: revoked.token });
    const unknown = await request(app)
      .post("/api/vendor-portal/session")
      .send({ token: generatePortalToken() });

    expect(res.status).toBe(unknown.status);
    expect(res.body).toEqual(unknown.body);
  });

  it("an EXPIRED invite says so — actionable, and not a useful oracle", async () => {
    // An attacker holding a valid 256-bit token learns nothing from being told
    // it aged out; a legitimate vendor needs to know to ask for a new link.
    const expired = await seedEngagementWithInvite(seed.orgA.id, "EXPIRED", { expiresInMs: -1000 });
    const res = await request(app).post("/api/vendor-portal/session").send({ token: expired.token });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("portal_link_expired");
  });

  it("records the exchange on the invite for audit", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "COUNTED");
    await sessionCookie(fresh.token);
    const row = await pool.query<{ exchange_count: number; first_exchanged_at: string | null }>(
      `SELECT exchange_count, first_exchanged_at FROM vendor_engagement_invites
        WHERE invite_token_hash = $1`,
      [hashPortalToken(fresh.token)]
    );
    expect(row.rows[0]!.exchange_count).toBe(1);
    expect(row.rows[0]!.first_exchanged_at).not.toBeNull();
  });
});

// ─── Cross-tenant ───────────────────────────────────────────────────────────

describe("Stop Gate B — a portal session reaches EXACTLY one engagement", () => {
  it("org A's session sees org A's engagement", async () => {
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.vendor_name).toMatch(/ORG-A-PORTAL/);
  });

  it("org A's session NEVER sees org B's data", async () => {
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(JSON.stringify(res.body)).not.toMatch(/ORG-B-SECRET/);
  });

  it("and org B's session sees only its own — the previous test is not vacuous", async () => {
    const cookie = await sessionCookie(tokens.b!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(res.body.vendor_name).toMatch(/ORG-B-SECRET/);
    expect(JSON.stringify(res.body)).not.toMatch(/ORG-A-PORTAL/);
  });

  it("supplying another engagement's id as a PARAMETER changes nothing", async () => {
    // There is no parameter to supply — but a caller (or an attacker probing the
    // shape) will try anyway. Identity comes from the session row.
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .query({
        engagement_id: engagements.b,
        engagementId: engagements.b,
        organization_id: seed.orgB.id,
      })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/ORG-B-SECRET/);
  });

  it("the response never leaks internal risk data to the vendor", async () => {
    // A vendor is shown who is asking and what state the request is in — never
    // ratings, findings, reviewer identities, or other vendors.
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    const keys = Object.keys(res.body);
    for (const forbidden of [
      "residual_rating", "residual_score", "inherent_rating", "inherent_score",
      "decision", "findings", "organization_id", "vendor_id", "engagement_id",
    ]) {
      expect(keys, `leaked ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ─── Session credentials ────────────────────────────────────────────────────

describe("Stop Gate B — session credentials", () => {
  it("no cookie is refused", async () => {
    const res = await request(app).get("/api/vendor-portal/engagement");
    expect(res.status).toBe(401);
  });

  it("a forged cookie is refused", async () => {
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", `${PORTAL_SESSION_COOKIE}=${generatePortalToken()}`);
    expect(res.status).toBe(401);
  });

  it("a REVOKED session stops working immediately — the kill switch", async () => {
    const cookie = await sessionCookie(tokens.a!);
    expect((await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie)).status).toBe(200);

    // Mass revocation: one UPDATE, as an operator would run it.
    await pool.query(
      `UPDATE vendor_portal_sessions SET revoked_at = NOW() WHERE engagement_id = $1`,
      [engagements.a]
    );

    const after = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  it("signing out revokes the session so the cookie cannot be replayed", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "SIGNOUT");
    const cookie = await sessionCookie(fresh.token);

    expect((await request(app).delete("/api/vendor-portal/session").set("Cookie", cookie)).status).toBe(200);
    const replay = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(replay.status).toBe(401);
  });

  it("a session token is NEVER stored raw — the DB holds only hashes", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "HASHONLY");
    const cookie = await sessionCookie(fresh.token);
    const rawValue = cookie.split("=")[1]!;

    const rows = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_portal_sessions WHERE session_token_hash = $1`,
      [rawValue]
    );
    // The raw value must match NOTHING; only its hash is stored.
    expect(rows.rows[0]!.n).toBe("0");

    const byHash = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_portal_sessions WHERE session_token_hash = $1`,
      [hashPortalToken(rawValue)]
    );
    expect(byHash.rows[0]!.n).toBe("1");
  });
});

// ─── The kill switch ────────────────────────────────────────────────────────

describe("Stop Gate B — the flag is a real kill switch", () => {
  it("OFF 404s every portal route, including the exchange", async () => {
    process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "false";

    const exchange = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    expect(exchange.status).toBe(404);

    const read = await request(app).get("/api/vendor-portal/engagement");
    expect(read.status).toBe(404);
  });

  it("OFF is the DEFAULT — an unset variable does not open the boundary", async () => {
    // Unlike vendorAssuranceFeatureFlag, which opens off-production. An external
    // write path must never be open by accident on a dev box or preview env.
    delete process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED;
    const res = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    expect(res.status).toBe(404);
  });

  it("turning it back ON restores service with no data change", async () => {
    process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "RESTORED");
    const res = await request(app).post("/api/vendor-portal/session").send({ token: fresh.token });
    expect(res.status).toBe(200);
  });
});

// ─── Auth-world separation ──────────────────────────────────────────────────

describe("Stop Gate B — the two authentication worlds cannot mix", () => {
  it("a portal session cannot reach a normal authenticated API route", async () => {
    const cookie = await sessionCookie(tokens.a!);
    for (const route of ["/api/vendors", "/api/findings", "/api/risks", "/api/ask"]) {
      const res = await request(app).get(route).set("Cookie", cookie);
      expect([401, 403, 404], `${route} accepted a portal cookie`).toContain(res.status);
    }
  });

  it("an org API key cannot drive a portal route", async () => {
    // The reverse direction. requirePortalSession reads a cookie and nothing
    // else, so an API key is simply not a portal credential.
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("x-api-key", seed.orgA.apiKey);
    expect(res.status).toBe(401);
  });
});
