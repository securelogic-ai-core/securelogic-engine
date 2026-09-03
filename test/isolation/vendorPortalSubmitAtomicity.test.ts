/**
 * vendorPortalSubmitAtomicity.test.ts — issue #949, against real Postgres.
 *
 * The invariant:
 *
 *   THE VENDOR MUST NEVER RECEIVE A SUCCESSFUL SUBMISSION RESPONSE UNLESS THE
 *   AUTHORITATIVE ENGAGEMENT STATE TRANSITION COMMITTED SUCCESSFULLY.
 *
 * ── Why this is NOT a copy of the #946 suite ────────────────────────────────
 *
 * `submitPortalResponses` already answered post-commit: its `withTenant` block
 * returns an outcome object and the response is written after the block
 * resolves. So the respond-before-commit half of #946 was never present here,
 * and there is nothing to prove about response ordering beyond confirming it
 * stayed correct.
 *
 * What WAS present is the guard half: a conditional
 * `UPDATE ... AND status = $from` whose rowCount was discarded, under a read
 * that took no row lock. A zero-row transition returned
 * `200 {ok: true, status: "submitted"}` plus a `vendor_portal.submitted` audit
 * event — telling a vendor their obligation was discharged when the
 * authoritative record said otherwise.
 *
 * The race is forced DETERMINISTICALLY by holding the engagement row's lock on
 * a pinned client. `pool.query("BEGIN")` would hand back an arbitrary pooled
 * connection per statement and deadlock CI, so the holder is pinned.
 *
 * Note on the tenant boundary: the portal takes NO identifier from the caller
 * (requirePortalSession INVARIANT 1 — org and engagement come from the session
 * row). There is no id to forge, so the boundary is proven by showing a session
 * affects only its own engagement and that a revoked session is refused.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import {
  hashPortalToken,
  generatePortalToken,
  PORTAL_SESSION_COOKIE,
} from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type Fixture = { engagementId: string; token: string; requirementId: string };

/** An `issued` engagement with a live invite and one mandatory, answerable item. */
async function seedIssued(orgId: string, label: string, opts: { revoked?: boolean } = {}): Promise<Fixture> {
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
       (organization_id, engagement_id, invite_token_hash, contact_email, expires_at, revoked_at, revocation_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orgId, engagementId, hashPortalToken(token), `${label}@example.com`,
      new Date(Date.now() + 30 * 24 * 3600_000),
      opts.revoked ? new Date() : null,
      opts.revoked ? "revoked for test" : null,
    ]
  );

  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );
  const req = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description)
     VALUES ($1, $2, $3, 'Guidance text.') RETURNING id`,
    [fw.rows[0]!.id, `${label}-REQ`, `${label} requirement`]
  );
  const requirementId = req.rows[0]!.id;

  await pool.query(
    `INSERT INTO vendor_engagement_scope_items
       (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons)
     VALUES ($1, $2, $3, 'full', TRUE, 'deterministic', $4::jsonb)`,
    [orgId, engagementId, requirementId,
     JSON.stringify([{ rule_id: "S1.baseline", rule_family: "S1", rationale: "Baseline for this tier." }])]
  );

  return { engagementId, token, requirementId };
}

/** Exchange an invite for a session cookie. This also moves issued -> in_progress. */
async function sessionCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
  expect(res.status, `exchange failed: ${JSON.stringify(res.body)}`).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!.split(";")[0]!;
}

/**
 * Answer the one mandatory item so the submit guard (`all_mandatory_answered`)
 * is satisfied. `answer` is a STRUCTURED value from PORTAL_ANSWERS, not prose —
 * the effectiveness ladder consumes it deterministically.
 */
async function answerAll(cookie: string, requirementId: string): Promise<void> {
  const r = await request(app)
    .put(`/api/vendor-portal/questions/${requirementId}`)
    .set("Cookie", cookie)
    .send({ answer: "pass", notes: "Implemented." });
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
}

const statusOf = async (id: string) =>
  (await pool.query<{ status: string; submitted_at: string | null }>(
    `SELECT status, submitted_at::text AS submitted_at FROM vendor_engagements WHERE id = $1`, [id]
  )).rows[0]!;

const submittedAuditCount = async (id: string) =>
  Number((await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM security_audit_log
      WHERE resource_id = $1 AND event_type = 'vendor_portal.submitted'`, [id]
  )).rows[0]!.n);

/**
 * Audit writes are FIRE-AND-FORGET — `writeAuditEvent` is not awaited, and on
 * the issue path it is deferred to after commit. Asserting the count the
 * instant a response lands is therefore a race: it passes file-by-file and
 * fails intermittently under full-suite load, which is exactly the flake class
 * this package exists to remove. Wait for the expected count instead.
 *
 * For an expected count of 0 there is nothing to wait FOR, so settle briefly
 * and then read — enough for a stray write to have landed if one were coming.
 */
async function awaitAuditCount(id: string, expected: number): Promise<number> {
  if (expected === 0) {
    await new Promise((r) => setTimeout(r, 300));
    return submittedAuditCount(id);
  }
  let n = 0;
  for (let i = 0; i < 120; i += 1) {
    n = await submittedAuditCount(id);
    if (n >= expected) return n;
    await new Promise((r) => setTimeout(r, 25));
  }
  return n;
}

/** Block until a backend is parked on a lock — makes the race deterministic. */
async function waitUntilBlockedOnLock(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND state = 'active' AND pid <> pg_backend_pid()`
    );
    if (Number(r.rows[0]!.n) > 0) return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error("the submit request never blocked on the row lock — the race was not forced");
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  process.env["SECURELOGIC_VENDOR_PORTAL_ENABLED"] = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => { await pool?.end(); });

describe("#949 · a successful submit means the transition committed", () => {
  it("a normal submit succeeds, transitions, audits once, and answers post-commit", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-happy");
    const cookie = await sessionCookie(fx.token);
    await answerAll(cookie, fx.requirementId);

    const r = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: "submitted" });

    // Read the instant the 200 lands — no polling. This route already answered
    // post-commit before the fix; the assertion pins that it still does.
    const row = await statusOf(fx.engagementId);
    expect(row.status).toBe("submitted");
    expect(row.submitted_at).not.toBeNull();
    expect(await awaitAuditCount(fx.engagementId, 1)).toBe(1);
  });

  it("a second submit is refused and writes no second audit event", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-twice");
    const cookie = await sessionCookie(fx.token);
    await answerAll(cookie, fx.requirementId);

    const first = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({});
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({});
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.ok).toBeUndefined();
    expect(await awaitAuditCount(fx.engagementId, 1)).toBe(1);
  });

  it("an incomplete questionnaire is refused with 422 and does not transition", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-incomplete");
    const cookie = await sessionCookie(fx.token);
    // deliberately no answers

    const r = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error).toBe("incomplete");

    expect((await statusOf(fx.engagementId)).status).toBe("in_progress");
    expect(await awaitAuditCount(fx.engagementId, 0)).toBe(0);
  });

  it("submitting from a stale state is refused and writes nothing", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-stale");
    const cookie = await sessionCookie(fx.token);
    await answerAll(cookie, fx.requirementId);

    // The reviewing org moves the engagement on underneath the vendor.
    await pool.query(`UPDATE vendor_engagements SET status = 'in_review' WHERE id = $1`, [fx.engagementId]);

    const r = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("cannot_submit");

    expect((await statusOf(fx.engagementId)).status).toBe("in_review");
    expect(await awaitAuditCount(fx.engagementId, 0)).toBe(0);
  });
});

describe("#949 · the race, forced deterministically", () => {
  it("a caller that loses the row lock gets NO success response and writes no audit event", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-lock-loser");
    const cookie = await sessionCookie(fx.token);
    await answerAll(cookie, fx.requirementId);

    const holder: PoolClient = await pool.connect();
    let inFlight!: Promise<request.Response>;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT status FROM vendor_engagements WHERE id = $1 FOR UPDATE`, [fx.engagementId]);

      // DISPATCH NOW. supertest is lazy — a Test fires on .then(), not .send() —
      // so assigning without attaching a handler would send this only at the
      // await below, i.e. AFTER the holder committed, and no race would occur.
      inFlight = new Promise<request.Response>((resolve, reject) => {
        void request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({})
          .then(resolve as (v: unknown) => void, reject);
      });

      await waitUntilBlockedOnLock();

      // Someone else submits it first.
      await holder.query(
        `UPDATE vendor_engagements SET status = 'submitted', submitted_at = NOW() WHERE id = $1`,
        [fx.engagementId]
      );
      await holder.query("COMMIT");
    } finally {
      holder.release();
    }

    const r = await inFlight;
    // THE INVARIANT: no success response for a transition this caller did not make.
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.ok).toBeUndefined();
    expect(["cannot_submit", "submit_conflict"]).toContain(r.body.error);

    // Exactly one authoritative transition, and the loser audited nothing.
    expect((await statusOf(fx.engagementId)).status).toBe("submitted");
    expect(await awaitAuditCount(fx.engagementId, 0)).toBe(0);
  });

  it("two concurrent submits produce exactly ONE success and ONE audit event", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-double");
    const cookie = await sessionCookie(fx.token);
    await answerAll(cookie, fx.requirementId);

    const [a, b] = await Promise.all([
      request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({}),
      request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({}),
    ]);

    const codes = [a.status, b.status].sort((x, y) => x - y);
    expect(codes, `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`).toEqual([200, 409]);

    const loser = a.status === 200 ? b : a;
    expect(loser.body.ok).toBeUndefined();

    expect((await statusOf(fx.engagementId)).status).toBe("submitted");
    expect(await awaitAuditCount(fx.engagementId, 1)).toBe(1);
  });
});

describe("#949 · the external portal authorization boundary", () => {
  it("no session, no submit", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-nosession");
    const r = await request(app).post("/api/vendor-portal/submit").send({});
    expect([401, 403]).toContain(r.status);
    expect((await statusOf(fx.engagementId)).status).toBe("issued");
  });

  it("a revoked invite yields no session, so it can never reach submit", async () => {
    const fx = await seedIssued(seed.orgA.id, "SUB-revoked", { revoked: true });
    const res = await request(app).post("/api/vendor-portal/session").send({ token: fx.token });
    expect(res.status).not.toBe(200);
    expect((await statusOf(fx.engagementId)).status).toBe("issued");
  });

  it("a session submits ONLY its own engagement — another org's is untouched", async () => {
    // The portal accepts no identifier from the caller (requirePortalSession
    // INVARIANT 1), so there is no id to forge. The property to prove is that
    // acting on one session leaves every other engagement exactly as it was.
    const mine = await seedIssued(seed.orgA.id, "SUB-mine");
    const theirs = await seedIssued(seed.orgB.id, "SUB-theirs");

    const cookie = await sessionCookie(mine.token);
    await answerAll(cookie, mine.requirementId);
    const r = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    expect((await statusOf(mine.engagementId)).status).toBe("submitted");
    // Org B's engagement never left `issued`, and audited nothing.
    expect((await statusOf(theirs.engagementId)).status).toBe("issued");
    expect(await awaitAuditCount(theirs.engagementId, 0)).toBe(0);
  });

  it("org B's session cannot submit using org A's cookie value", async () => {
    // A stolen-cookie shape: the session row decides the engagement, so B's
    // cookie can only ever move B's engagement — never A's.
    const a = await seedIssued(seed.orgA.id, "SUB-xt-a");
    const b = await seedIssued(seed.orgB.id, "SUB-xt-b");
    const bCookie = await sessionCookie(b.token);
    await answerAll(bCookie, b.requirementId);

    const r = await request(app).post("/api/vendor-portal/submit").set("Cookie", bCookie).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    expect((await statusOf(b.engagementId)).status).toBe("submitted");
    expect((await statusOf(a.engagementId)).status).toBe("issued");
    expect(await awaitAuditCount(a.engagementId, 0)).toBe(0);
  });
});
