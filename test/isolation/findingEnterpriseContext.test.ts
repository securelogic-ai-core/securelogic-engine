/**
 * findingEnterpriseContext.test.ts — C4 part 3 (ADR-0003 D2-A) against real Postgres.
 *
 * The panel's whole job is to be HONEST, so the tests are about the states, not the
 * numbers. "We looked and found nothing", "we could not look", and "we tried and failed"
 * are three different things to someone deciding whether to act, and the panel must never
 * blur them.
 *
 * It also pins the direction bug that would otherwise ship a lie: edges mean "X depends on
 * Y", so traversing OUTBOUND from a vendor finds nothing and would report "nothing depends
 * on Microsoft" while the assets that do sit one hop away.
 *
 * READ-ONLY: nothing here writes a canonical store (ERIP-AD-8 / AD-10 unamended).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { backfillAssetRegistry } from "../../src/api/lib/assetRegistrar.js";
import { resolveFindingEnterpriseContext } from "../../src/api/lib/findingEnterpriseContext.js";

let seed: TestDbSeed;
let pool: Pool;

async function makeVendor(orgId: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name]
  );
  await backfillAssetRegistry(pool);
  return r.rows[0]!.id;
}

/** An app that DEPENDS ON the vendor — the edge points INTO the vendor. */
async function makeDependentApp(orgId: string, name: string, vendorId: string): Promise<void> {
  const e = await pool.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name)
     VALUES ($1, 'application', $2) RETURNING id`,
    [orgId, name]
  );
  await backfillAssetRegistry(pool);
  const assetId = (
    await pool.query<{ asset_id: string }>(
      `SELECT asset_id FROM asset_registry_v WHERE organization_id = $1 AND name = $2`,
      [orgId, name]
    )
  ).rows[0]!.asset_id;
  await pool.query(
    `INSERT INTO enterprise_relationships
       (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, 'asset', $2, 'vendor', $3, 'depends_on')`,
    [orgId, assetId, vendorId]
  );
  void e;
}

async function ctxFor(orgId: string, vendors: Array<{ id: string; name: string }>) {
  const c = await pool.connect();
  try {
    await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    return await resolveFindingEnterpriseContext(c, orgId, { vendors, ai_systems: [] });
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  pool = new Pool({ connectionString: url });
});

afterAll(async () => {
  await pool?.end();
});

describe("blast radius — the direction that stops us shipping a lie", () => {
  it("finds what depends ON the vendor (INBOUND), not what the vendor depends on", async () => {
    const name = `Contoso-${crypto.randomUUID().slice(0, 6)}`;
    const vendorId = await makeVendor(seed.orgA.id, name);
    await makeDependentApp(seed.orgA.id, `App-A-${crypto.randomUUID().slice(0, 4)}`, vendorId);
    await makeDependentApp(seed.orgA.id, `App-B-${crypto.randomUUID().slice(0, 4)}`, vendorId);

    const ctx = await ctxFor(seed.orgA.id, [{ id: vendorId, name }]);

    // With an OUTBOUND traversal this is `none_found` with 0 dependencies — i.e. the panel
    // would say "nothing depends on Contoso" while two apps do. That sentence reads exactly
    // like "safe to ignore", which is why the direction is pinned here.
    expect(ctx.blast_radius.status).toBe("resolved");
    expect(ctx.blast_radius.dependency_count).toBe(2);
    expect(ctx.blast_radius.root).toMatchObject({ node_type: "vendor", node_id: vendorId });
    expect(ctx.blast_radius.reason).toContain("depend on");
  });

  it("an honest zero: a vendor with no dependents is `none_found`, not an error", async () => {
    const name = `Lonely-${crypto.randomUUID().slice(0, 6)}`;
    const vendorId = await makeVendor(seed.orgA.id, name);

    const ctx = await ctxFor(seed.orgA.id, [{ id: vendorId, name }]);
    expect(ctx.blast_radius.status).toBe("none_found");
    expect(ctx.blast_radius.dependency_count).toBe(0);
    expect(ctx.blast_radius.root).not.toBeNull(); // we DID have somewhere to look
  });

  it("`not_applicable` when there is nothing to root at — distinct from an empty result", async () => {
    // A control_test finding affects only controls. Controls are canonical GRC objects and
    // structurally are not graph nodes: we cannot look, which is not the same as looking
    // and finding nothing.
    const ctx = await ctxFor(seed.orgA.id, []);
    expect(ctx.blast_radius.status).toBe("not_applicable");
    expect(ctx.blast_radius.root).toBeNull();
    // No fabricated number. NULL, not 0.
    expect(ctx.blast_radius.business_impact_score).toBeNull();
    expect(ctx.blast_radius.business_impact_band).toBeNull();
  });

  it("never leaks another org's graph — org B's dependents are invisible to org A", async () => {
    const name = `Shared-${crypto.randomUUID().slice(0, 6)}`;
    const vendorA = await makeVendor(seed.orgA.id, name);
    const vendorB = await makeVendor(seed.orgB.id, name);
    await makeDependentApp(seed.orgB.id, `B-App-${crypto.randomUUID().slice(0, 4)}`, vendorB);

    // Org A's vendor of the same name has no dependents of its own.
    const asA = await ctxFor(seed.orgA.id, [{ id: vendorA, name }]);
    expect(asA.blast_radius.status).toBe("none_found");
    expect(asA.blast_radius.dependency_count).toBe(0);

    // Org B's does.
    const asB = await ctxFor(seed.orgB.id, [{ id: vendorB, name }]);
    expect(asB.blast_radius.dependency_count).toBe(1);
  });
});

describe("org profile — reported, never inferred", () => {
  it("reads the profile verbatim and marks it `assessed` when it has been set", async () => {
    await pool.query(
      `UPDATE organizations SET regulated = TRUE, handles_pii = TRUE, scale = 'Enterprise' WHERE id = $1`,
      [seed.orgA.id]
    );
    const ctx = await ctxFor(seed.orgA.id, []);
    expect(ctx.org_profile.status).toBe("assessed");
    expect(ctx.org_profile.regulated).toBe(true);
    expect(ctx.org_profile.handles_pii).toBe(true);
    expect(ctx.org_profile.scale).toBe("Enterprise");
    expect(ctx.org_profile.note).toContain("regulated");
  });

  it("`defaults_only` when nothing was ever set — we cannot claim 'not regulated'", async () => {
    // The columns are NOT NULL with defaults, so an org nobody ever asked is
    // indistinguishable from a small unregulated one. Saying "assessed: not regulated"
    // would be a claim we cannot support, so we say what we actually know.
    await pool.query(
      `UPDATE organizations
          SET regulated = FALSE, handles_pii = FALSE, safety_critical = FALSE, scale = 'Small'
        WHERE id = $1`,
      [seed.orgB.id]
    );
    const ctx = await ctxFor(seed.orgB.id, []);
    expect(ctx.org_profile.status).toBe("defaults_only");
    expect(ctx.org_profile.note).toContain("has not been set");
    expect(ctx.org_profile.note).toContain("not the same as");
  });
});
