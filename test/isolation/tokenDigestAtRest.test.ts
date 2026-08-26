/**
 * tokenDigestAtRest.test.ts — token-at-rest hardening package (2026-08-17):
 * proof over the REAL app + REAL Postgres of the operator-required behaviors
 * for the three legacy capability-token families
 * (users.email_verification_token, users.password_reset_token,
 * org_invites.token).
 *
 *   1. newly issued tokens work end-to-end;
 *   2. the STORED value is a `sha256:` digest, not the raw token
 *      (asserted on an APP-issued token via /auth/forgot-password);
 *   3. presenting the stored digest itself never redeems (the exact
 *      DB-leak replay attack);
 *   4. legacy RAW-stored rows still work during the compatibility window;
 *   5. legacy rows are consumed exactly like digest rows (single use);
 *   6. wrong / expired / replayed tokens fail exactly as before;
 *   7. uniqueness/lookup behavior is intact (two invites, right row wins).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "crypto";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { digestToken } from "../../src/api/lib/tokenDigest.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

const PW = "CorrectHorse99Battery";

function rawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function seedUser(email: string, cols: Record<string, unknown>): Promise<string> {
  const base: Record<string, unknown> = {
    organization_id: seed.orgA.id, email, name: "Token Probe",
    password_hash: "x", role: "member", email_verified: true
  };
  const merged = { ...base, ...cols }; // overrides win; no duplicate columns
  const keys = Object.keys(merged);
  const vals = Object.values(merged);
  const params = vals.map((_, i) => `$${i + 1}`).join(", ");
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (${keys.join(", ")}) VALUES (${params}) RETURNING id`, vals);
  return r.rows[0].id;
}

beforeAll(async () => {
  // verify-email signs a session JWT on success; the harness env has no secret.
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "token-digest-harness-secret";
  seed = await bootstrapTestDb();
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("token digest at rest", () => {
  it("(1)(5)(6) verification: digest-stored token verifies end-to-end, single-use, wrong token refused", async () => {
    const raw = rawToken();
    await seedUser("verify-digest@tokens.test", {
      email_verified: false,
      email_verification_token: digestToken(raw),
      email_verification_expires_at: new Date(Date.now() + 60 * 60 * 1000)
    });

    const wrong = await request(app).post("/api/auth/verify-email").send({ token: rawToken() });
    expect(wrong.status).toBe(404);

    const ok = await request(app).post("/api/auth/verify-email").send({ token: raw });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const replay = await request(app).post("/api/auth/verify-email").send({ token: raw });
    expect(replay.status).toBe(404); // consumed — token nulled

    const row = await pool.query(
      `SELECT email_verified, email_verification_token FROM users WHERE email = 'verify-digest@tokens.test'`);
    expect(row.rows[0].email_verified).toBe(true);
    expect(row.rows[0].email_verification_token).toBeNull();
  });

  it("(2) an APP-issued reset token is stored as a sha256: digest, never raw", async () => {
    await seedUser("forgot-shape@tokens.test", {});
    const r = await request(app).post("/api/auth/forgot-password").send({ email: "forgot-shape@tokens.test" });
    expect(r.status).toBe(200); // always-OK semantics preserved
    const row = await pool.query<{ password_reset_token: string }>(
      `SELECT password_reset_token FROM users WHERE email = 'forgot-shape@tokens.test'`);
    const stored = row.rows[0].password_reset_token;
    expect(stored).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored).not.toMatch(/^[a-f0-9]{64}$/); // not a raw presentable token
  });

  it("(3) presenting the STORED DIGEST itself never redeems — the DB-leak replay attack", async () => {
    const raw = rawToken();
    const stored = digestToken(raw);
    await seedUser("digest-replay@tokens.test", {
      password_reset_token: stored,
      password_reset_expires_at: new Date(Date.now() + 60 * 60 * 1000)
    });
    const attack = await request(app).post("/api/auth/reset-password")
      .send({ token: stored, password: PW });
    expect(attack.status).toBe(404); // shape-guarded before any lookup
    const untouched = await pool.query(
      `SELECT password_reset_token FROM users WHERE email = 'digest-replay@tokens.test'`);
    expect(untouched.rows[0].password_reset_token).toBe(stored); // nothing consumed
    // the REAL raw still works — proving the guard blocked only the digest
    const legit = await request(app).post("/api/auth/reset-password")
      .send({ token: raw, password: PW });
    expect(legit.status).toBe(200);
  });

  it("(4)(5) a LEGACY raw-stored reset token still works during the window and is consumed", async () => {
    const raw = rawToken();
    await seedUser("legacy-reset@tokens.test", {
      password_reset_token: raw, // pre-package storage form
      password_reset_expires_at: new Date(Date.now() + 60 * 60 * 1000)
    });
    const ok = await request(app).post("/api/auth/reset-password")
      .send({ token: raw, password: PW });
    expect(ok.status).toBe(200);
    const row = await pool.query(
      `SELECT password_reset_token FROM users WHERE email = 'legacy-reset@tokens.test'`);
    expect(row.rows[0].password_reset_token).toBeNull(); // consumed exactly as before
    const replay = await request(app).post("/api/auth/reset-password")
      .send({ token: raw, password: PW });
    expect(replay.status).toBe(404);
  });

  it("(6) an EXPIRED digest-stored reset token still fails with the expiry semantics", async () => {
    const raw = rawToken();
    await seedUser("expired-reset@tokens.test", {
      password_reset_token: digestToken(raw),
      password_reset_expires_at: new Date(Date.now() - 60 * 1000)
    });
    const r = await request(app).post("/api/auth/reset-password").send({ token: raw, password: PW });
    expect(r.status).toBe(410);
  });

  it("(1)(4)(7) invites: digest-stored and legacy raw invites both preview correctly; distinct tokens hit distinct rows; stored digest never previews as valid", async () => {
    const rawNew = rawToken();
    const rawLegacy = rawToken();
    const inviterId = await seedUser("inviter@tokens.test", {});
    await pool.query(
      `INSERT INTO org_invites (organization_id, invited_by_user_id, email, role, token, status, expires_at)
       VALUES ($1, $4, 'inv-digest@tokens.test', 'member', $2, 'pending', now() + interval '7 days'),
              ($1, $4, 'inv-legacy@tokens.test', 'member', $3, 'pending', now() + interval '7 days')`,
      [seed.orgA.id, digestToken(rawNew), rawLegacy, inviterId]);

    const p1 = await request(app).get(`/api/team/invites/${rawNew}/preview`);
    expect(p1.status).toBe(200);
    expect(p1.body.valid).toBe(true);
    expect(p1.body.email).toBe("inv-digest@tokens.test"); // right row, not the legacy one

    const p2 = await request(app).get(`/api/team/invites/${rawLegacy}/preview`);
    expect(p2.body.valid).toBe(true);
    expect(p2.body.email).toBe("inv-legacy@tokens.test");

    const p3 = await request(app).get(`/api/team/invites/${digestToken(rawNew)}/preview`);
    expect(p3.body.valid).toBe(false); // stored digest is not a presentable token

    const p4 = await request(app).get(`/api/team/invites/${rawToken()}/preview`);
    expect(p4.body.valid).toBe(false); // unknown token unchanged semantics
  });
});
