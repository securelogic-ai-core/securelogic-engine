/**
 * vendorEngagementsRls.test.ts — Stop Gate A evidence for the Vendor Assurance
 * workflow spine.
 *
 * vendor_engagements is the row every other object in the programme hangs off:
 * inherent and residual ratings, the frozen questionnaire scope, the decision,
 * the monitoring cadence. It is also the row an EXTERNAL portal session resolves
 * from its token. Cross-tenant leakage here is not one leaked record — it is a
 * different customer's entire third-party risk posture, including the ratings
 * their board sees.
 *
 * Certifies isolation at the DATABASE layer, not the application layer: the
 * harness superuser does SET ROLE app_request (NOBYPASSRLS, non-owner) and every
 * scoped case runs inside BEGIN … ROLLBACK with SET LOCAL ROLE plus a
 * transaction-local GUC via set_config(…, true). That is what "proven, not
 * declared" means for this gate — an application-layer WHERE clause proves
 * nothing about what the database would return if a handler forgot one.
 *
 * Mirrors vendorAssessmentsRls.test.ts exactly.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let vendorA: string;
let vendorB: string;
let engagementA: string;
let engagementB: string;

/**
 * A constraint-satisfying INSERT. Every CHECK on the table is satisfied, so the
 * ONLY thing that can reject this row is RLS — which is the point: a test whose
 * insert fails a CHECK would pass for the wrong reason.
 */
const INSERT_ENGAGEMENT = `INSERT INTO vendor_engagements
    (organization_id, vendor_id, engagement_type, status,
     methodology_version, scope_rule_version)
  VALUES ($1, $2, 'initial', 'draft', '1.0.0', '1.0.0')
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the vendor_engagements RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Seed as the owner (RLS bypassed for seeding).
  vendorA = await seedVendor(pool, seed.orgA.id, { name: "VE Org A vendor" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "VE Org B vendor" });
  const a = await pool.query(INSERT_ENGAGEMENT, [seed.orgA.id, vendorA]);
  engagementA = a.rows[0].id as string;
  const b = await pool.query(INSERT_ENGAGEMENT, [seed.orgB.id, vendorB]);
  engagementB = b.rows[0].id as string;
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

/** Run `fn` as app_request scoped to `orgId`, always rolled back. */
async function asOrg<T>(orgId: string | null, fn: (c: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    if (orgId !== null) {
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    }
    return await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    client.release();
  }
}

describe("Stop Gate A — vendor_engagements RLS enforcement", () => {
  it("org A sees its own engagements and NONE of org B's", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      const own = await client.query("SELECT id FROM vendor_engagements WHERE id = $1", [
        engagementA,
      ]);
      expect(own.rowCount).toBe(1);

      // Explicitly ASKING for the other org's row must still return nothing —
      // the policy filters, it does not merely fail to volunteer.
      const cross = await client.query("SELECT id FROM vendor_engagements WHERE id = $1", [
        engagementB,
      ]);
      expect(cross.rowCount).toBe(0);

      const byOrg = await client.query(
        "SELECT id FROM vendor_engagements WHERE organization_id = $1",
        [seed.orgB.id]
      );
      expect(byOrg.rowCount).toBe(0);
    });
  });

  it("an unscoped SELECT returns ONLY the caller's org — no accidental cross-tenant list", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      const all = await client.query("SELECT organization_id FROM vendor_engagements");
      expect(all.rowCount).toBeGreaterThan(0);
      for (const row of all.rows) {
        expect(row.organization_id).toBe(seed.orgA.id);
      }
    });
  });

  it("org A cannot INSERT an engagement stamped for org B (WITH CHECK)", async () => {
    // The write half. Without WITH CHECK a tenant could plant rows in another
    // org's register that they then could not see — silent corruption.
    await asOrg(seed.orgA.id, async (client) => {
      await expect(
        client.query(INSERT_ENGAGEMENT, [seed.orgB.id, vendorB])
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("org A cannot UPDATE org B's engagement — including its RATING", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      const r = await client.query(
        `UPDATE vendor_engagements
            SET residual_rating = 'Low', residual_score = 1
          WHERE id = $1`,
        [engagementB]
      );
      // Zero rows affected: the row is invisible, so there is nothing to update.
      expect(r.rowCount).toBe(0);
    });

    // And the row is genuinely untouched when read back as the owner.
    const check = await pool.query(
      "SELECT residual_rating, residual_score FROM vendor_engagements WHERE id = $1",
      [engagementB]
    );
    expect(check.rows[0].residual_rating).toBeNull();
    expect(check.rows[0].residual_score).toBeNull();
  });

  it("org A cannot DELETE org B's engagement", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      const r = await client.query("DELETE FROM vendor_engagements WHERE id = $1", [engagementB]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("a MISSING org GUC fails CLOSED — zero rows, never an error, never everything", async () => {
    // Pooled app_request resets the GUC to '' between checkouts. NULLIF(...,'')
    // makes that resolve to NULL, so the predicate is false and the caller sees
    // nothing. A bare ''::uuid cast would throw a 500 instead of isolating, and
    // omitting the guard entirely would expose every tenant.
    await asOrg(null, async (client) => {
      const r = await client.query("SELECT id FROM vendor_engagements");
      expect(r.rowCount).toBe(0);
    });
  });

  it("an EMPTY-STRING org GUC also fails closed rather than throwing", async () => {
    await asOrg(null, async (client) => {
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const r = await client.query("SELECT id FROM vendor_engagements");
      expect(r.rowCount).toBe(0);
    });
  });

  it("the policy is NOT FORCE — the owner channel still sees across orgs", async () => {
    // pgElevated, migrations, and the portal's pre-org-context token lookup all
    // depend on the owner bypassing RLS. If this ever starts returning one org's
    // rows, those paths break in ways that look like data loss.
    const r = await pool.query("SELECT DISTINCT organization_id FROM vendor_engagements");
    expect(r.rowCount).toBeGreaterThanOrEqual(2);
  });
});

describe("Stop Gate A — vendor_engagements schema invariants", () => {
  it("RLS is enabled and the tenant policy exists", async () => {
    const rls = await pool.query(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = 'vendor_engagements'`
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    // NOT FORCE — deliberate, see above.
    expect(rls.rows[0].relforcerowsecurity).toBe(false);

    const pol = await pool.query(
      `SELECT policyname FROM pg_policies
        WHERE tablename = 'vendor_engagements'`
    );
    expect(pol.rows.map((r) => r.policyname)).toContain(
      "vendor_engagements_tenant_isolation"
    );
  });

  it("app_request holds the DML grant it needs (or it gets permission-denied, not filtering)", async () => {
    // Tables created after 20260621 need an explicit grant. Without it
    // app_request hits "permission denied" — which looks like isolation working
    // but is actually the feature being broken for everyone.
    const r = await pool.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'vendor_engagements' AND grantee = 'app_request'`
    );
    const privs = r.rows.map((x) => x.privilege_type).sort();
    expect(privs).toEqual(expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"]));
  });

  it("a decision cannot be recorded without a rationale", async () => {
    // Ratified: high-impact governance actions require rationale and audit
    // evidence. Enforced in the schema so no code path can record a bare verdict.
    await expect(
      pool.query(
        `INSERT INTO vendor_engagements
           (organization_id, vendor_id, engagement_type, status,
            methodology_version, scope_rule_version, decision, decided_at)
         VALUES ($1, $2, 'initial', 'decided', '1.0.0', '1.0.0', 'approved', NOW())`,
        [seed.orgA.id, vendorA]
      )
    ).rejects.toThrow(/vendor_engagements_decision_consistency/);
  });

  it("only a TARGETED engagement may descend from a parent", async () => {
    await expect(
      pool.query(
        `INSERT INTO vendor_engagements
           (organization_id, vendor_id, engagement_type, status,
            methodology_version, scope_rule_version, parent_engagement_id)
         VALUES ($1, $2, 'periodic', 'draft', '1.0.0', '1.0.0', $3)`,
        [seed.orgA.id, vendorA, engagementA]
      )
    ).rejects.toThrow(/vendor_engagements_parent_requires_targeted/);
  });

  it("scores are constrained to the 0-100 scale they share with the risk register", async () => {
    await expect(
      pool.query(
        `INSERT INTO vendor_engagements
           (organization_id, vendor_id, engagement_type, status,
            methodology_version, scope_rule_version, residual_score)
         VALUES ($1, $2, 'initial', 'draft', '1.0.0', '1.0.0', 101)`,
        [seed.orgA.id, vendorA]
      )
    ).rejects.toThrow(/residual_score/);
  });

  it("cancellation always carries a reason", async () => {
    await expect(
      pool.query(
        `INSERT INTO vendor_engagements
           (organization_id, vendor_id, engagement_type, status,
            methodology_version, scope_rule_version)
         VALUES ($1, $2, 'initial', 'cancelled', '1.0.0', '1.0.0')`,
        [seed.orgA.id, vendorA]
      )
    ).rejects.toThrow(/vendor_engagements_cancellation_reason/);
  });
});
