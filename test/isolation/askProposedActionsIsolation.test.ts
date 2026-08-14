/**
 * askProposedActionsIsolation.test.ts — Stop Gate ASK-B at the data layer
 * (migration 20261002_ask_proposed_actions.sql), against real Postgres.
 *
 * Two halves:
 *
 *   1. THE SHIPPED STORE SEMANTICS (src/api/lib/ask/proposalStore.ts, run via
 *      the real withTenant): user binding, org binding, single-use atomic
 *      claim under real concurrency, expiry, decline terminality. These are the
 *      operator's replay / stale-proposal / context-pinning proofs executed
 *      against the exact SQL that ships.
 *
 *   2. RLS ENFORCEMENT (SET ROLE app_request): the tenant policy on
 *      ask_proposed_actions holds for SELECT and for cross-org writes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import {
  claimPendingByTokenHash,
  createProposal,
  declineByTokenHash,
  PROPOSAL_TTL_MS,
} from "../../src/api/lib/ask/proposalStore.js";

let seed: TestDbSeed;
let pool: Pool;
let userA1: string;
let userA2: string;
let userB1: string;

const TOOL_INPUT = { title: "Patch the edge routers", source_type: "manual", priority: "immediate" };

function mint(userId: string, orgId: string) {
  return withTenant(orgId, () =>
    createProposal({
      organizationId: orgId,
      userId,
      conversationId: null,
      toolName: "actions.create",
      toolInput: TOOL_INPUT,
      summary: 'Create remediation action: "Patch the edge routers"',
    })
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA1 = (await seedUser(pool, seed.orgA.id)).id;
  userA2 = (await seedUser(pool, seed.orgA.id)).id;
  userB1 = (await seedUser(pool, seed.orgB.id)).id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("ASK-B — proposal claim binding (real store SQL)", () => {
  it("the issuing user in the issuing org claims exactly once; the frozen input comes back", async () => {
    const p = await mint(userA1, seed.orgA.id);
    expect(p.token).toMatch(/^[0-9a-f]{64}$/);

    const claimed = await withTenant(seed.orgA.id, () =>
      claimPendingByTokenHash({ organizationId: seed.orgA.id, userId: userA1, rawToken: p.token })
    );
    expect(claimed).not.toBeNull();
    expect(claimed!.tool_name).toBe("actions.create");
    expect(claimed!.tool_input).toEqual(TOOL_INPUT);

    // Replay: the same token again is a miss — single use is terminal.
    const replay = await withTenant(seed.orgA.id, () =>
      claimPendingByTokenHash({ organizationId: seed.orgA.id, userId: userA1, rawToken: p.token })
    );
    expect(replay).toBeNull();
  });

  it("a COLLEAGUE in the same org cannot claim it (user binding, not just org binding)", async () => {
    const p = await mint(userA1, seed.orgA.id);
    const asColleague = await withTenant(seed.orgA.id, () =>
      claimPendingByTokenHash({ organizationId: seed.orgA.id, userId: userA2, rawToken: p.token })
    );
    expect(asColleague).toBeNull();

    // Still pending — the miss consumed nothing.
    const asOwner = await withTenant(seed.orgA.id, () =>
      claimPendingByTokenHash({ organizationId: seed.orgA.id, userId: userA1, rawToken: p.token })
    );
    expect(asOwner).not.toBeNull();
  });

  it("ANOTHER ORG cannot claim it even with the raw token (tenant binding)", async () => {
    const p = await mint(userA1, seed.orgA.id);
    const crossOrg = await withTenant(seed.orgB.id, () =>
      claimPendingByTokenHash({ organizationId: seed.orgB.id, userId: userB1, rawToken: p.token })
    );
    expect(crossOrg).toBeNull();
  });

  it("double-submit under real concurrency: exactly one winner", async () => {
    const p = await mint(userA1, seed.orgA.id);
    const attempt = () =>
      withTenant(seed.orgA.id, () =>
        claimPendingByTokenHash({ organizationId: seed.orgA.id, userId: userA1, rawToken: p.token })
      );
    const [first, second] = await Promise.all([attempt(), attempt()]);
    const winners = [first, second].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });

  it("an expired proposal cannot execute, and the presented row is marked expired", async () => {
    const p = await mint(userA1, seed.orgA.id);
    // Age it past the TTL as the owner connection (setup channel).
    await pool.query(
      `UPDATE ask_proposed_actions SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [p.id]
    );
    const claimed = await withTenant(seed.orgA.id, () =>
      claimPendingByTokenHash({ organizationId: seed.orgA.id, userId: userA1, rawToken: p.token })
    );
    expect(claimed).toBeNull();
    const row = await pool.query(`SELECT status FROM ask_proposed_actions WHERE id = $1`, [p.id]);
    expect(row.rows[0].status).toBe("expired");
  });

  it("declined is terminal: a declined proposal can never be confirmed", async () => {
    const p = await mint(userA1, seed.orgA.id);
    const declined = await withTenant(seed.orgA.id, () =>
      declineByTokenHash({ organizationId: seed.orgA.id, userId: userA1, rawToken: p.token })
    );
    expect(declined).not.toBeNull();
    const confirmAfter = await withTenant(seed.orgA.id, () =>
      claimPendingByTokenHash({ organizationId: seed.orgA.id, userId: userA1, rawToken: p.token })
    );
    expect(confirmAfter).toBeNull();
  });

  it("the raw token is never persisted — only its hash", async () => {
    const p = await mint(userA1, seed.orgA.id);
    const row = await pool.query(
      `SELECT token_hash FROM ask_proposed_actions WHERE id = $1`,
      [p.id]
    );
    expect(row.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0].token_hash).not.toBe(p.token);
    // And nothing else in the row could reconstruct it.
    const whole = await pool.query(`SELECT to_jsonb(a) AS j FROM ask_proposed_actions a WHERE id = $1`, [p.id]);
    expect(JSON.stringify(whole.rows[0].j)).not.toContain(p.token);
  });

  it("TTL is the shipped constant", async () => {
    const p = await mint(userA1, seed.orgA.id);
    const row = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) * 1000 AS ttl
         FROM ask_proposed_actions WHERE id = $1`,
      [p.id]
    );
    expect(Math.round(Number(row.rows[0].ttl))).toBe(PROPOSAL_TTL_MS);
  });
});

describe("ASK-B — RLS enforcement on ask_proposed_actions", () => {
  it("app_request scoped to org A cannot read org B's proposals", async () => {
    await mint(userB1, seed.orgB.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const crossOrg = await client.query(
        "SELECT id FROM ask_proposed_actions WHERE organization_id = $1",
        [seed.orgB.id]
      );
      expect(crossOrg.rowCount).toBe(0);
      const visible = await client.query("SELECT organization_id FROM ask_proposed_actions");
      for (const r of visible.rows) expect(r.organization_id).toBe(seed.orgA.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a proposal claiming org B", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(
          `INSERT INTO ask_proposed_actions
             (organization_id, user_id, tool_name, tool_input, summary, token_hash, expires_at)
           VALUES ($1, $2, 'actions.create', '{}', 's', 'h-cross-org-attempt', NOW() + INTERVAL '15 minutes')`,
          [seed.orgB.id, userB1]
        )
      ).rejects.toThrow(/row-level security/);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE org A's pending proposal (rowCount 0)", async () => {
    const p = await mint(userA1, seed.orgA.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const res = await client.query(
        `UPDATE ask_proposed_actions SET status = 'confirmed' WHERE id = $1`,
        [p.id]
      );
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
