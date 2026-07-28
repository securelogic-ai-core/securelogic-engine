/**
 * ssoCodeExchange.test.ts — SSO one-time login codes against real Postgres.
 *
 * What only the real schema can prove:
 *   1. create → consume returns the payload exactly ONCE; the second consume
 *      of the same code loses the atomic claim (single-use, replay-safe);
 *   2. an expired code is inert even when never consumed;
 *   3. the stored row carries the sha256, never the raw code;
 *   4. FK integrity: deleting the user cascades the code away (erasure needs
 *      no reaper step, as the classification entry claims);
 *   5. org binding: a code minted for an org A user yields org A identity,
 *      even when an identically-named user exists in org B (security review
 *      #710 finding 3 — insurance against a future refactor adding an org
 *      input to the exchange).
 */

process.env.JWT_SECRET ??= "test-jwt-secret-for-sso-exchange";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import {
  createSsoLoginCode,
  consumeSsoLoginCode,
} from "../../src/api/lib/ssoLoginCodes.js";

let seed: TestDbSeed;
let pool: Pool;
let userA = "";

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the SSO exchange test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id, { email: "sso@a.test", name: "Sso User" })).id;
}, 300_000);

afterAll(async () => {
  await pool?.end();
});

describe("SSO login codes — single-use against the real schema", () => {
  it("consume returns the payload exactly once; replay loses the atomic claim", async () => {
    const raw = await createSsoLoginCode({
      organizationId: seed.orgA.id,
      userId: userA,
      email: "sso@a.test",
      displayName: "Sso User",
    });

    const first = await consumeSsoLoginCode(raw);
    expect(first).toEqual({
      organizationId: seed.orgA.id,
      userId: userA,
      email: "sso@a.test",
      displayName: "Sso User",
    });

    expect(await consumeSsoLoginCode(raw)).toBeNull();
  });

  it("stores the sha256, never the raw code", async () => {
    const raw = await createSsoLoginCode({
      organizationId: seed.orgA.id,
      userId: userA,
      email: "sso@a.test",
      displayName: "Sso User",
    });
    const hash = crypto.createHash("sha256").update(raw).digest("hex");

    const byHash = await pool.query(`SELECT 1 FROM sso_login_codes WHERE code_hash = $1`, [hash]);
    expect(byHash.rowCount).toBe(1);
    const byRaw = await pool.query(`SELECT 1 FROM sso_login_codes WHERE code_hash = $1`, [raw]);
    expect(byRaw.rowCount).toBe(0);
  });

  it("an expired code is inert even when never consumed", async () => {
    const raw = "c".repeat(64);
    await pool.query(
      `INSERT INTO sso_login_codes
         (organization_id, user_id, code_hash, email, display_name, expires_at)
       VALUES ($1, $2, $3, 'sso@a.test', 'Sso User', NOW() - interval '1 second')`,
      [seed.orgA.id, userA, crypto.createHash("sha256").update(raw).digest("hex")]
    );

    expect(await consumeSsoLoginCode(raw)).toBeNull();
  });

  it("a code minted in org A can never yield org B identity, even with a same-email user in org B", async () => {
    // The classic confusion setup: the SAME email exists in both orgs. The
    // exchange takes no org parameter — identity must come solely from the
    // minted row, never from any email/org lookup that could cross tenants.
    const twinEmail = "twin@shared.test";
    const twinA = (await seedUser(pool, seed.orgA.id, { email: twinEmail, name: "Twin A" })).id;
    const twinB = (await seedUser(pool, seed.orgB.id, { email: twinEmail, name: "Twin B" })).id;

    const raw = await createSsoLoginCode({
      organizationId: seed.orgA.id,
      userId: twinA,
      email: twinEmail,
      displayName: "Twin A",
    });

    const payload = await consumeSsoLoginCode(raw);
    expect(payload).not.toBeNull();
    expect(payload!.organizationId).toBe(seed.orgA.id);
    expect(payload!.userId).toBe(twinA);
    expect(payload!.organizationId).not.toBe(seed.orgB.id);
    expect(payload!.userId).not.toBe(twinB);
  });

  it("deleting the user cascades the code away (erasure without a reaper step)", async () => {
    const victim = (await seedUser(pool, seed.orgB.id, { email: "victim@b.test" })).id;
    await createSsoLoginCode({
      organizationId: seed.orgB.id,
      userId: victim,
      email: "victim@b.test",
      displayName: "Victim",
    });

    await pool.query(`DELETE FROM users WHERE id = $1`, [victim]);

    const remaining = await pool.query(
      `SELECT COUNT(*)::text AS n FROM sso_login_codes WHERE user_id = $1`,
      [victim]
    );
    expect(remaining.rows[0].n).toBe("0");
  });
});
