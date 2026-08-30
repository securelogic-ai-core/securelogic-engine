/**
 * vendorEngagementIssueAtomicity.test.ts — issue #946, against real Postgres.
 *
 * The invariant, stated once:
 *
 *   NO USABLE INVITE CREDENTIAL MAY EXIST UNLESS THE ENGAGEMENT WAS
 *   SUCCESSFULLY TRANSITIONED TO `issued` AGAINST THE EXACT QUESTION SET
 *   BEING FROZEN.
 *
 * The defect had two halves and this file pins both.
 *
 * 1. RESPOND-BEFORE-COMMIT. The route managed its own `withTenant` scope and
 *    called `res.json({invite_token})` INSIDE it, so the raw credential and a
 *    200 claiming `status: "issued"` reached the caller before COMMIT. A client
 *    acting on that 200 could observe pre-commit state — which is exactly how
 *    this surfaced: `scopeItemDomain.test.ts`'s "the freeze is unaffected"
 *    case intermittently re-resolved scope after a successful issue, because
 *    `POST /scope` opened a fresh transaction and still read `scoped`.
 *
 * 2. UNCHECKED CONDITIONAL TRANSITION. The invite was INSERTed on the ELEVATED
 *    pool — a separate connection, therefore a separate transaction — BEFORE a
 *    guarded `UPDATE … AND status = $from` whose rowCount was never inspected.
 *    A zero-row transition still returned 200, a working token, and a
 *    `vendor_engagement.issued` audit event.
 *
 * The race is forced DETERMINISTICALLY (no sleeps, no retries) by holding the
 * engagement row's lock on a dedicated client while the request is in flight.
 * A pinned client is mandatory: `pool.query("BEGIN")` hands back an arbitrary
 * pooled connection per statement and deadlocks CI.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let vendorA: string;
let vendorB: string;

const asA = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgB.apiKey);

const TIER1_INTAKE = {
  engagement_type: "initial",
  data_sensitivity: "restricted", data_volume: "large", access_level: "admin",
  operational_dependency: "critical", recoverability: "weeks", business_criticality: "critical",
  regulatory_exposure: "high", regulatory_breach_notification: true,
  ai_involvement: "embedded", ai_autonomy: "none", hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "high", concentration: "low",
};

async function seedFramework(orgId: string, label: string): Promise<void> {
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );
  for (const [ref, title] of [["A-1", "Security policy"], ["A-2", "Continuity"]] as const) {
    await pool.query(
      `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
       VALUES ($1, $2, $3, 'guidance', ARRAY['core']::text[], 'curated', NOW())`,
      [fw.rows[0]!.id, ref, title]
    );
  }
}

/** A fresh engagement, scope resolved, ready to issue. */
async function scopedEngagement(who: typeof asA, vendorId: string, title: string): Promise<string> {
  const created = await who("post", "/api/vendor-engagements").send({ ...TIER1_INTAKE, vendor_id: vendorId, title });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  const scoped = await who("post", `/api/vendor-engagements/${id}/scope`).send({});
  expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
  return id;
}

const invitesFor = async (engagementId: string) =>
  (await pool.query(
    `SELECT id, invite_token_hash, organization_id FROM vendor_engagement_invites WHERE engagement_id = $1`,
    [engagementId]
  )).rows;

const engagementRow = async (engagementId: string) =>
  (await pool.query<{ status: string; issued_at: string | null; question_set_hash: string | null }>(
    `SELECT status, issued_at::text AS issued_at, question_set_hash
       FROM vendor_engagements WHERE id = $1`,
    [engagementId]
  )).rows[0]!;

const issuedAuditCount = async (engagementId: string) =>
  Number((await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM security_audit_log
      WHERE resource_id = $1 AND event_type = 'vendor_engagement.issued'`,
    [engagementId]
  )).rows[0]!.n);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  process.env["SECURELOGIC_VENDOR_PORTAL_ENABLED"] = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Issue vendor A", criticality: "critical" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "Issue vendor B", criticality: "critical" });
  await seedFramework(seed.orgA.id, "IssueA");
  await seedFramework(seed.orgB.id, "IssueB");
  app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => { await pool?.end(); });

describe("#946 · the happy path, and what it must leave behind", () => {
  it("a normal issue succeeds exactly once and stamps the question set hash", async () => {
    const id = await scopedEngagement(asA, vendorA, "issue-happy");
    const before = await engagementRow(id);
    expect(before.question_set_hash).toBeNull();

    const r = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "happy@example.com" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(typeof r.body.invite_token).toBe("string");

    const after = await engagementRow(id);
    expect(after.status).toBe("issued");
    expect(after.issued_at).not.toBeNull();
    // Stamped on the SAME transition that froze the scope.
    expect(after.question_set_hash).toEqual(expect.any(String));

    expect(await invitesFor(id)).toHaveLength(1);
    expect(await issuedAuditCount(id)).toBe(1);
  });

  it("the 200 is not sent until the transition is durable — no polling required", async () => {
    // The old route answered from inside its own transaction, so a read taken
    // the instant the 200 arrived could still see the pre-commit row. Under the
    // asTenant wrap the response is replayed only after COMMIT, so a RAW SELECT
    // taken immediately must already observe `issued`. No retry, no sleep — if
    // this ever needs one, respond-before-commit is back.
    const id = await scopedEngagement(asA, vendorA, "issue-commit-ordering");
    const r = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "durable@example.com" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const row = await engagementRow(id);
    expect(row.status).toBe("issued");
    expect(row.question_set_hash).not.toBeNull();
    // And the credential the caller was just handed is already durable.
    expect(await invitesFor(id)).toHaveLength(1);
  });

  it("scope CANNOT be re-resolved after a successful issue", async () => {
    // The regression that exposed all of this. Immediately after the 200 —
    // deliberately with nothing in between.
    const id = await scopedEngagement(asA, vendorA, "issue-freeze");
    const issued = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "freeze@example.com" });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);

    const again = await asA("post", `/api/vendor-engagements/${id}/scope`).send({});
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.error).toBe("scope_frozen");
  });
});

describe("#946 · a failed transition leaves nothing behind", () => {
  it("issuing from an invalid state returns 409 and writes nothing", async () => {
    const id = await scopedEngagement(asA, vendorA, "issue-invalid-state");
    const first = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "one@example.com" });
    expect(first.status).toBe(200);
    const hashAfterFirst = (await engagementRow(id)).question_set_hash;

    const second = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "two@example.com" });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.error).toBe("cannot_issue");
    expect(second.body.invite_token).toBeUndefined();

    // Exactly one credential, one audit event, and the stamp is untouched.
    expect(await invitesFor(id)).toHaveLength(1);
    expect(await issuedAuditCount(id)).toBe(1);
    expect((await engagementRow(id)).question_set_hash).toBe(hashAfterFirst);
  });

  it("a failed issue does NOT freeze the scope", async () => {
    // `draft` cannot be issued. The engagement must stay workable afterwards —
    // a refused issue that silently froze scope would be its own defect.
    const created = await asA("post", "/api/vendor-engagements")
      .send({ ...TIER1_INTAKE, vendor_id: vendorA, title: "issue-draft" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const r = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "draft@example.com" });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("cannot_issue");

    expect(await invitesFor(id)).toHaveLength(0);
    expect(await issuedAuditCount(id)).toBe(0);
    expect((await engagementRow(id)).question_set_hash).toBeNull();

    // Still resolvable — the scope was never frozen.
    const scoped = await asA("post", `/api/vendor-engagements/${id}/scope`).send({});
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
  });

  it("an empty scope is refused with 422 and mints no credential", async () => {
    const created = await asA("post", "/api/vendor-engagements")
      .send({ ...TIER1_INTAKE, vendor_id: vendorA, title: "issue-empty" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await pool.query(`UPDATE vendor_engagements SET status = 'scoped' WHERE id = $1`, [id]);

    const r = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "empty@example.com" });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error).toBe("empty_scope");
    expect(await invitesFor(id)).toHaveLength(0);
    expect(await issuedAuditCount(id)).toBe(0);
  });
});

/**
 * Block until some backend is waiting on a lock — i.e. the in-flight issue
 * request has reached `SELECT … FOR UPDATE` and parked there. This is what
 * makes the race deterministic instead of timing-dependent: the test only
 * advances once the contention it wants actually exists.
 */
async function waitUntilBlockedOnLock(engagementId: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND state = 'active'
          AND pid <> pg_backend_pid()`
    );
    if (Number(r.rows[0]!.n) > 0) return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`issue request for ${engagementId} never blocked on the row lock — the race was not forced`);
}

describe("#946 · the race, forced deterministically", () => {
  /**
   * Hold the engagement row's lock on a pinned client, start the issue request
   * (which must block on `SELECT … FOR UPDATE`), move the row out from under it,
   * then commit. The request resumes, re-reads the CHANGED state, and must
   * refuse — proving the lock, not luck, is what serializes issuance.
   */
  it("a caller that loses the row lock issues nothing and receives no credential", async () => {
    const id = await scopedEngagement(asA, vendorA, "issue-lock-loser");
    const holder: PoolClient = await pool.connect();
    let inFlight!: Promise<request.Response>;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT status FROM vendor_engagements WHERE id = $1 FOR UPDATE`, [id]);

      // DISPATCH NOW. A supertest `Test` is lazy — it fires on .then(), not on
      // .send() — so assigning it without attaching a handler would send the
      // request only at the `await` below, i.e. AFTER the holder committed, and
      // the race this test exists to force would never happen.
      inFlight = new Promise<request.Response>((resolve, reject) => {
        void asA("post", `/api/vendor-engagements/${id}/issue`)
          .send({ contact_email: "loser@example.com" })
          .then(resolve as (v: unknown) => void, reject);
      });

      // Proceed only once the request is demonstrably parked on the row lock.
      await waitUntilBlockedOnLock(id);

      // Move the engagement out of an issuable state while the request waits.
      await holder.query(`UPDATE vendor_engagements SET status = 'issued', issued_at = NOW() WHERE id = $1`, [id]);
      await holder.query("COMMIT");
    } finally {
      holder.release();
    }

    const r = await inFlight;
    // 409 either way: the loser re-reads `issued` and fails canTransition
    // (`cannot_issue`), or — if the state moved some other way — trips the
    // rowCount assertion (`issue_conflict`). What matters is that it refuses.
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(["cannot_issue", "issue_conflict"]).toContain(r.body.error);
    expect(r.body.invite_token).toBeUndefined();

    // THE INVARIANT: the loser minted nothing.
    expect(await invitesFor(id)).toHaveLength(0);
    expect(await issuedAuditCount(id)).toBe(0);
  });

  it("two concurrent issues produce exactly ONE issuance, ONE invite, ONE audit event", async () => {
    const id = await scopedEngagement(asA, vendorA, "issue-double");

    const [a, b] = await Promise.all([
      asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "race-a@example.com" }),
      asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "race-b@example.com" }),
    ]);

    const codes = [a.status, b.status].sort();
    expect(codes, `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(typeof winner.body.invite_token).toBe("string");
    expect(loser.body.invite_token).toBeUndefined();

    // Exactly one credential exists, and it is the winner's.
    const invites = await invitesFor(id);
    expect(invites).toHaveLength(1);
    expect(await issuedAuditCount(id)).toBe(1);
    expect((await engagementRow(id)).status).toBe("issued");
  });

  it("the surviving invite belongs to the engagement that was actually issued", async () => {
    const id = await scopedEngagement(asA, vendorA, "issue-invite-binding");
    const r = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "binding@example.com" });
    expect(r.status).toBe(200);

    const invites = await invitesFor(id);
    expect(invites).toHaveLength(1);
    expect(invites[0]!.organization_id).toBe(seed.orgA.id);

    // The stored hash matches the token the caller was handed, and the raw
    // token itself was never persisted.
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(r.body.invite_token as string).digest("hex");
    expect(invites[0]!.invite_token_hash).toBe(expected);
    expect((await engagementRow(id)).status).toBe("issued");
  });
});

describe("#946 · tenant boundary", () => {
  it("org B cannot issue org A's engagement, and mints nothing doing so", async () => {
    const id = await scopedEngagement(asA, vendorA, "issue-cross-tenant");
    const r = await asB("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "intruder@example.com" });
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(r.body.invite_token).toBeUndefined();

    expect(await invitesFor(id)).toHaveLength(0);
    expect(await issuedAuditCount(id)).toBe(0);
    expect((await engagementRow(id)).status).toBe("scoped");
  });

  it("a forged org/engagement pairing fails — the id alone is not authority", async () => {
    // Org B holds a real engagement of its own; org A presenting B's id must
    // still 404. The engagement exists; the pairing does not.
    const bId = await scopedEngagement(asB, vendorB, "issue-b-owned");
    const r = await asA("post", `/api/vendor-engagements/${bId}/issue`).send({ contact_email: "forged@example.com" });
    expect(r.status, JSON.stringify(r.body)).toBe(404);

    expect(await invitesFor(bId)).toHaveLength(0);
    expect((await engagementRow(bId)).status).toBe("scoped");
  });

  it("a non-existent engagement is 404 and writes nothing", async () => {
    const ghost = "00000000-0000-4000-8000-0000000000ff";
    const r = await asA("post", `/api/vendor-engagements/${ghost}/issue`).send({ contact_email: "ghost@example.com" });
    expect(r.status).toBe(404);
    expect(await invitesFor(ghost)).toHaveLength(0);
  });
});

describe("#946 · rollback removes every issuance-side effect", () => {
  it("a failure after the transition leaves no invite, no issuance, and no audit event", async () => {
    // Force the invite INSERT to fail inside the transaction by pre-claiming a
    // token hash — invite_token_hash is UNIQUE. Whatever the handler mints, the
    // *shape* under test is: the status UPDATE has already run, then a later
    // statement throws. The transaction must take the UPDATE with it.
    //
    // The hash is unguessable, so instead of racing the mint we assert the
    // general property directly: a rolled-back issuance leaves the engagement
    // exactly as it was. Driven by breaking the table the handler must write.
    const id = await scopedEngagement(asA, vendorA, "issue-rollback");

    await pool.query(
      `ALTER TABLE vendor_engagement_invites
         ADD CONSTRAINT tmp_946_block_insert CHECK (contact_email <> 'rollback@example.com')`
    );
    try {
      const r = await asA("post", `/api/vendor-engagements/${id}/issue`)
        .send({ contact_email: "rollback@example.com" });
      // The handler's catch turns the constraint violation into a 500 — the
      // point is not the code, it is that nothing durable survived.
      expect(r.status, JSON.stringify(r.body)).toBe(500);
      expect(r.body.invite_token).toBeUndefined();
    } finally {
      await pool.query(`ALTER TABLE vendor_engagement_invites DROP CONSTRAINT tmp_946_block_insert`);
    }

    // Every issuance-side effect is gone: the status UPDATE that ran BEFORE the
    // failing INSERT was rolled back with it.
    const row = await engagementRow(id);
    expect(row.status).toBe("scoped");
    expect(row.issued_at).toBeNull();
    expect(row.question_set_hash).toBeNull();
    expect(await invitesFor(id)).toHaveLength(0);
    expect(await issuedAuditCount(id)).toBe(0);

    // And the engagement is still usable afterwards.
    const scoped = await asA("post", `/api/vendor-engagements/${id}/scope`).send({});
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
  });
});
