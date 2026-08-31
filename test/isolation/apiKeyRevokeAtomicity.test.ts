/**
 * apiKeyRevokeAtomicity.test.ts — the API-key revocation P1, against real Postgres.
 *
 * The invariant:
 *
 *   A SUCCESSFUL REVOCATION RESPONSE == THE AUTHORITATIVE CREDENTIAL STATE IS
 *   COMMITTED AS REVOKED.
 *
 * ── What was and was NOT wrong here ─────────────────────────────────────────
 *
 * This route is already `asTenant`-wrapped, so it was already one transaction
 * that answers only after COMMIT — the respond-before-commit half of #946 was
 * never present. It already required a JWT, so the attribution problem of #947
 * was never present either. What was missing is SERIALIZATION, and it left two
 * distinct races:
 *
 *   1. FALSE SUCCESS. Two revocations of the SAME key both read `active`; one
 *      commits; the other's `UPDATE ... AND status = 'active'` matches zero
 *      rows, its rowCount is discarded, and the caller is still told
 *      `{ok: true}` with a second `api_key.revoked` audit event.
 *
 *   2. LAST-KEY BYPASS — the worse one. Two revocations of DIFFERENT keys both
 *      read an active count of 2, both pass the last-active-key guard, and both
 *      commit, leaving the organisation with ZERO active keys and locked out of
 *      its own API. Locking only the target row would not fix this, because the
 *      two transactions touch different rows and never contend.
 *
 * Both races are forced DETERMINISTICALLY with a pinned lock holder.
 */

process.env["JWT_SECRET"] ??= "test-jwt-secret-for-api-key-revoke";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let jwtA = "";
let jwtB = "";

const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

/** A key with a KNOWN raw value, so it can be presented at the door afterwards. */
async function makeKey(orgId: string, label: string): Promise<{ id: string; raw: string }> {
  const raw = `sl_test_${crypto.randomBytes(18).toString("hex")}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO api_keys (organization_id, label, key_hash, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [orgId, label, hash(raw)]
  );
  return { id: r.rows[0]!.id, raw };
}

const keyRow = async (id: string) =>
  (await pool.query<{ status: string; revoked_at: string | null }>(
    `SELECT status, revoked_at::text AS revoked_at FROM api_keys WHERE id = $1`, [id]
  )).rows[0]!;

const activeCount = async (orgId: string) =>
  Number((await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM api_keys WHERE organization_id = $1 AND status = 'active'`, [orgId]
  )).rows[0]!.n);

const revokeAuditCountRaw = async (keyId: string) =>
  Number((await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM security_audit_log
      WHERE resource_id = $1 AND event_type = 'api_key.revoked'`, [keyId]
  )).rows[0]!.n);

/**
 * Audit writes are deferred to after commit and are fire-and-forget, so reading
 * the count the instant a response lands is a race that passes file-by-file and
 * fails under full-suite load. Wait for the expected value instead; for an
 * expected 0 settle briefly, since there is nothing to wait for.
 */
async function awaitRevokeAudits(keyId: string, expected: number): Promise<number> {
  if (expected === 0) {
    await new Promise((r) => setTimeout(r, 300));
    return revokeAuditCountRaw(keyId);
  }
  let n = 0;
  for (let i = 0; i < 120; i += 1) {
    n = await revokeAuditCountRaw(keyId);
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
  throw new Error("the revoke request never blocked on the row lock — the race was not forced");
}

const revoke = (keyId: string, jwt: string) =>
  request(app).delete(`/api/customer/keys/${keyId}`).set("Authorization", `Bearer ${jwt}`).send();

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  pool = new Pool({ connectionString: url, ssl: false });

  const uA = await seedUser(pool, seed.orgA.id, { email: "keyadmin-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "keyadmin-b@example.com" });
  for (const [u, org] of [[uA, seed.orgA.id], [uB, seed.orgB.id]] as const) {
    await recordAllCurrentConsents(pool, { userId: u.id, organizationId: org, consentMethod: "admin_recorded" });
  }
  jwtA = signJwt(uA.id, seed.orgA.id, "admin");
  jwtB = signJwt(uB.id, seed.orgB.id, "admin");

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 300_000);

afterAll(async () => { await pool?.end(); });

describe("revocation · the ordinary paths", () => {
  it("a normal revoke succeeds and the credential is ACTUALLY unusable afterwards", async () => {
    const doomed = await makeKey(seed.orgA.id, "revoke-normal");
    await makeKey(seed.orgA.id, "revoke-normal-spare");

    // The key works before.
    const before = await request(app).get("/api/customer/keys").set("X-Api-Key", doomed.raw);
    expect(before.status, JSON.stringify(before.body)).toBe(200);

    const r = await revoke(doomed.id, jwtA);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ ok: true });

    const row = await keyRow(doomed.id);
    expect(row.status).toBe("revoked");
    expect(row.revoked_at).not.toBeNull();
    expect(await awaitRevokeAudits(doomed.id, 1)).toBe(1);

    // THE POINT OF REVOCATION: the credential is refused at the door, and
    // refused specifically BECAUSE it is no longer active — not merely
    // unauthenticated for some other reason.
    const after = await request(app).get("/api/customer/keys").set("X-Api-Key", doomed.raw);
    expect([401, 403], JSON.stringify(after.body)).toContain(after.status);
    expect(after.body.error).toBe("api_key_inactive");
  });

  it("revoking an ALREADY-revoked key is refused and writes no second audit event", async () => {
    const k = await makeKey(seed.orgA.id, "revoke-twice");
    await makeKey(seed.orgA.id, "revoke-twice-spare");

    expect((await revoke(k.id, jwtA)).status).toBe(200);
    expect(await awaitRevokeAudits(k.id, 1)).toBe(1);

    const second = await revoke(k.id, jwtA);
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.error).toBe("key_already_revoked");
    expect(second.body.ok).toBeUndefined();
    expect(await awaitRevokeAudits(k.id, 1)).toBe(1);
  });

  it("a nonexistent key is 404 and writes nothing", async () => {
    const ghost = "00000000-0000-4000-8000-00000000dead";
    const r = await revoke(ghost, jwtA);
    expect(r.status).toBe(404);
    expect(r.body.ok).toBeUndefined();
    expect(await awaitRevokeAudits(ghost, 0)).toBe(0);
  });

  it("the LAST active key cannot be revoked", async () => {
    // Org B starts with exactly the one key testDb seeded.
    const only = await pool.query<{ id: string }>(
      `SELECT id FROM api_keys WHERE organization_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`,
      [seed.orgB.id]
    );
    expect(await activeCount(seed.orgB.id)).toBe(1);
    const r = await revoke(only.rows[0]!.id, jwtB);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("last_active_key");
    expect(await activeCount(seed.orgB.id)).toBe(1);
  });
});

describe("revocation · tenant isolation", () => {
  it("another org cannot revoke this org's key — 404, nothing written, key still usable", async () => {
    const k = await makeKey(seed.orgA.id, "revoke-xtenant");
    await makeKey(seed.orgA.id, "revoke-xtenant-spare");

    const r = await revoke(k.id, jwtB);
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(r.body.ok).toBeUndefined();

    expect((await keyRow(k.id)).status).toBe("active");
    expect(await awaitRevokeAudits(k.id, 0)).toBe(0);
    // Still accepted at the door — a cross-tenant call did not disable it.
    const probe = await request(app).get("/api/customer/keys").set("X-Api-Key", k.raw);
    expect(probe.status).toBe(200);
  });

  it("revocation requires a JWT — an API-key-only caller cannot revoke", async () => {
    const k = await makeKey(seed.orgA.id, "revoke-nojwt");
    await makeKey(seed.orgA.id, "revoke-nojwt-spare");
    const r = await request(app)
      .delete(`/api/customer/keys/${k.id}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send();
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe("jwt_required");
    expect((await keyRow(k.id)).status).toBe("active");
    expect(await awaitRevokeAudits(k.id, 0)).toBe(0);
  });
});

describe("revocation · the races, forced deterministically", () => {
  it("a caller that loses the row lock CANNOT falsely report a new revocation", async () => {
    const k = await makeKey(seed.orgA.id, "race-loser");
    await makeKey(seed.orgA.id, "race-loser-spare");

    const holder: PoolClient = await pool.connect();
    let inFlight!: Promise<request.Response>;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM api_keys WHERE id = $1 FOR UPDATE`, [k.id]);

      // Dispatch NOW — supertest fires on .then(), not on .send().
      inFlight = new Promise<request.Response>((resolve, reject) => {
        void revoke(k.id, jwtA).then(resolve as (v: unknown) => void, reject);
      });
      await waitUntilBlockedOnLock();

      // Someone else revokes it first.
      await holder.query(
        `UPDATE api_keys SET status = 'revoked', revoked_at = NOW() WHERE id = $1`, [k.id]
      );
      await holder.query("COMMIT");
    } finally {
      holder.release();
    }

    const r = await inFlight;
    // THE INVARIANT: no success response for a revocation this caller did not make.
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.ok).toBeUndefined();
    expect(["key_already_revoked", "revoke_conflict"]).toContain(r.body.error);

    // The key is revoked (by the other actor) and the loser audited nothing.
    expect((await keyRow(k.id)).status).toBe("revoked");
    expect(await awaitRevokeAudits(k.id, 0)).toBe(0);
  });

  it("two concurrent revokes of the SAME key produce exactly ONE success and ONE audit event", async () => {
    const k = await makeKey(seed.orgA.id, "race-double");
    await makeKey(seed.orgA.id, "race-double-spare");

    const [a, b] = await Promise.all([revoke(k.id, jwtA), revoke(k.id, jwtA)]);
    expect([a.status, b.status].sort((x, y) => x - y), `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`)
      .toEqual([200, 409]);

    const loser = a.status === 200 ? b : a;
    expect(loser.body.ok).toBeUndefined();
    expect((await keyRow(k.id)).status).toBe("revoked");
    expect(await awaitRevokeAudits(k.id, 1)).toBe(1);
  });

  it("the LAST-KEY GUARD survives concurrency — an org can never be left with zero active keys", async () => {
    // The worse race. Two revocations of DIFFERENT keys, with exactly two
    // active. Both used to read a count of 2, both passed the guard, and both
    // committed — locking the organisation out of its own API. Locking only the
    // target row would not fix it: the two transactions touch different rows.
    const orgActive = await pool.query<{ id: string }>(
      `SELECT id FROM api_keys WHERE organization_id = $1 AND status = 'active'`, [seed.orgA.id]
    );
    // Reduce org A to exactly two active keys.
    for (const row of orgActive.rows.slice(2)) {
      await pool.query(`UPDATE api_keys SET status = 'revoked', revoked_at = NOW() WHERE id = $1`, [row.id]);
    }
    while (await activeCount(seed.orgA.id) < 2) await makeKey(seed.orgA.id, "race-lastkey-filler");
    const twoLeft = await pool.query<{ id: string }>(
      `SELECT id FROM api_keys WHERE organization_id = $1 AND status = 'active' ORDER BY id`, [seed.orgA.id]
    );
    expect(twoLeft.rowCount).toBe(2);
    const [k1, k2] = [twoLeft.rows[0]!.id, twoLeft.rows[1]!.id];

    const [a, b] = await Promise.all([revoke(k1, jwtA), revoke(k2, jwtA)]);
    const codes = [a.status, b.status].sort((x, y) => x - y);
    expect(codes, `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`).toEqual([200, 409]);

    // THE POINT: at least one key is still active. The org is not locked out.
    expect(await activeCount(seed.orgA.id)).toBe(1);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toBe("last_active_key");
  });
});
