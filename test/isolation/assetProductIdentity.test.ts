/**
 * assetProductIdentity.test.ts — C4 (ADR-0003 D1) against real Postgres.
 *
 * Proves what only a real database can:
 *   - CROSS-ORG: org B's attestation NEVER resolves for org A, and RLS refuses to leak
 *     it even when queried directly under org A's GUC;
 *   - the EVIDENCE GATE is real: evidence (attestation/sbom/connector) clears
 *     applicabilityPolicy.matchThresholds.high (70); a bare NAME coincidence (60) does
 *     not, so it can never assert `affected`;
 *   - AUTHORITY ORDER: a human attestation outranks a machine observation for the same
 *     asset — without deleting it (both rows coexist; the resolver prefers one);
 *   - AMBIGUITY SURVIVES ATTESTATION: attesting two assets to one product still yields
 *     `ambiguous`, never an auto-pick. A human declaring something does not collapse a
 *     genuine ambiguity;
 *   - the DB CHECK holds: machine provenance may not carry an actor, and an attestation
 *     must have one.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { backfillAssetRegistry } from "../../src/api/lib/assetRegistrar.js";
import { resolveTenantAssets, IDENTITY_CONFIDENCE } from "../../src/api/lib/tenantAssetResolver.js";
import { canonicalProductIdentity } from "../../src/api/lib/canonicalProduct.js";
import { upsertCanonicalProduct } from "../../src/api/lib/canonicalProductStore.js";
import { DEFAULT_APPLICABILITY_POLICY } from "../../src/engine/applicability/v1/applicabilityPolicy.js";

const HIGH = DEFAULT_APPLICABILITY_POLICY.matchThresholds.high;

let seed: TestDbSeed;
let pool: Pool;
/** A user per org — an attestation must be attributable (20260905 CHECK). */
const userOf: Record<string, string> = {};

async function makeUser(orgId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, role, status)
     VALUES ($1, $2, 'admin', 'active') RETURNING id`,
    [orgId, `attestor-${crypto.randomUUID()}@isolation.test`]
  );
  return r.rows[0]!.id;
}

/** An asset whose NAME is deliberately NOT the product — the realistic case. */
async function makeAsset(orgId: string, name: string): Promise<string> {
  await pool.query(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name) VALUES ($1, 'application', $2)`,
    [orgId, name]
  );
  await backfillAssetRegistry(pool);
  const r = await pool.query<{ asset_id: string }>(
    `SELECT rv.asset_id FROM asset_registry_v rv WHERE rv.organization_id = $1 AND rv.name = $2`,
    [orgId, name]
  );
  return r.rows[0]!.asset_id;
}

async function makeProduct(vendor: string, product: string): Promise<string> {
  const c = await pool.connect();
  try {
    const rec = await upsertCanonicalProduct(c, {
      identity: { vendor, product, cve: null },
      aliases: [{ raw: product, source: "test" }],
    });
    return rec.id;
  } finally {
    c.release();
  }
}

async function addIdentity(
  orgId: string,
  assetId: string,
  productId: string,
  provenance: "attestation" | "sbom" | "connector",
  actor: string | null
): Promise<void> {
  await pool.query(
    `INSERT INTO asset_product_identities
       (organization_id, asset_id, canonical_product_id, provenance, confidence, evidence_ref, attested_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, assetId, productId, provenance, IDENTITY_CONFIDENCE[provenance], `${provenance}:test`, actor]
  );
}

/** Resolve as `orgId`, with that org's RLS GUC set — the way the app really runs. */
async function resolveAs(orgId: string, vendor: string, product: string) {
  const c = await pool.connect();
  try {
    await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    return await resolveTenantAssets(c, orgId, canonicalProductIdentity({ vendor, product, cve: null }));
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the asset product identity test.");
  pool = new Pool({ connectionString: url });
  userOf[seed.orgA.id] = await makeUser(seed.orgA.id);
  userOf[seed.orgB.id] = await makeUser(seed.orgB.id);
});

afterAll(async () => {
  await pool?.end();
});

describe("C4 — evidence gives an asset product identity", () => {
  it("EVIDENCE resolves an asset whose NAME does not look like the product at all", async () => {
    const product = `Exchange Server ${crypto.randomUUID().slice(0, 6)}`;
    const productId = await makeProduct("Microsoft", product);
    // The realistic name. Under the old exact-name resolver this NEVER matched.
    const assetId = await makeAsset(seed.orgA.id, `EXCH-PROD-${crypto.randomUUID().slice(0, 4)}`);

    const before = await resolveAs(seed.orgA.id, "Microsoft", product);
    expect(before.status).toBe("no_match");

    await addIdentity(seed.orgA.id, assetId, productId, "connector", null);

    const after = await resolveAs(seed.orgA.id, "Microsoft", product);
    expect(after.status).toBe("resolved");
    expect(after.candidates).toHaveLength(1);
    expect(after.candidates[0]!.confidence).toBe(IDENTITY_CONFIDENCE.connector);
    // Clears the R2 gate -> the engine may conclude `affected`.
    expect(after.candidates[0]!.confidence).toBeGreaterThanOrEqual(HIGH);
    expect(after.candidates[0]!.match_rationale).toContain("connector");
  });

  it("a NAME COINCIDENCE resolves but CANNOT support `affected` (below the R2 gate)", async () => {
    const product = `Nimbus ${crypto.randomUUID().slice(0, 6)}`;
    await makeProduct("Acme", product);
    // No evidence — the asset merely happens to be NAMED like the product.
    await makeAsset(seed.orgA.id, product);

    const out = await resolveAs(seed.orgA.id, "Acme", product);
    expect(out.status).toBe("resolved");
    expect(out.candidates[0]!.confidence).toBe(IDENTITY_CONFIDENCE.inferred);
    expect(out.candidates[0]!.confidence).toBeLessThan(HIGH); // -> potentially_affected at most
    expect(out.candidates[0]!.match_rationale).toContain("inferred");
  });

  it("a human ATTESTATION outranks a machine observation — and does not delete it", async () => {
    const product = `Kestrel ${crypto.randomUUID().slice(0, 6)}`;
    const productId = await makeProduct("Acme", product);
    const assetId = await makeAsset(seed.orgA.id, `KST-${crypto.randomUUID().slice(0, 4)}`);

    await addIdentity(seed.orgA.id, assetId, productId, "connector", null);
    await addIdentity(seed.orgA.id, assetId, productId, "attestation", userOf[seed.orgA.id]!);

    const out = await resolveAs(seed.orgA.id, "Acme", product);
    expect(out.status).toBe("resolved");
    // ONE candidate for the asset — the highest-authority one wins the row...
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]!.confidence).toBe(IDENTITY_CONFIDENCE.attestation);
    expect(out.candidates[0]!.match_rationale).toContain("attestation");

    // ...but the machine's observation is still ON RECORD. Attestation is supporting
    // evidence (ADR-0003 D1) — it overrides, it does not erase what was observed.
    const rows = await pool.query(
      `SELECT provenance FROM asset_product_identities
        WHERE organization_id = $1 AND asset_id = $2 ORDER BY provenance`,
      [seed.orgA.id, assetId]
    );
    expect(rows.rows.map((r) => r.provenance)).toEqual(["attestation", "connector"]);
  });

  it("AMBIGUITY SURVIVES attestation — declaring two assets does not auto-pick one", async () => {
    const product = `Vireo ${crypto.randomUUID().slice(0, 6)}`;
    const productId = await makeProduct("Acme", product);
    const a1 = await makeAsset(seed.orgA.id, `VIR-A-${crypto.randomUUID().slice(0, 4)}`);
    const a2 = await makeAsset(seed.orgA.id, `VIR-B-${crypto.randomUUID().slice(0, 4)}`);

    await addIdentity(seed.orgA.id, a1, productId, "attestation", userOf[seed.orgA.id]!);
    await addIdentity(seed.orgA.id, a2, productId, "attestation", userOf[seed.orgA.id]!);

    const out = await resolveAs(seed.orgA.id, "Acme", product);
    // A human asserting two things does not make the ambiguity go away.
    expect(out.status).toBe("ambiguous");
    expect(out.candidates).toHaveLength(2);
  });
});

describe("C4 — tenant isolation", () => {
  it("org B's attestation NEVER resolves for org A", async () => {
    const product = `Petrel ${crypto.randomUUID().slice(0, 6)}`;
    const productId = await makeProduct("Acme", product);
    const bAsset = await makeAsset(seed.orgB.id, `PTR-${crypto.randomUUID().slice(0, 4)}`);
    await addIdentity(seed.orgB.id, bAsset, productId, "attestation", userOf[seed.orgB.id]!);

    // Org B sees it...
    const asB = await resolveAs(seed.orgB.id, "Acme", product);
    expect(asB.status).toBe("resolved");

    // ...org A sees nothing. Same product, same global canonical_products row.
    const asA = await resolveAs(seed.orgA.id, "Acme", product);
    expect(asA.status).toBe("no_match");
    expect(asA.candidates).toEqual([]);
  });

  it("RLS refuses the cross-org row even on a direct query under org A's GUC", async () => {
    const product = `Auklet ${crypto.randomUUID().slice(0, 6)}`;
    const productId = await makeProduct("Acme", product);
    const bAsset = await makeAsset(seed.orgB.id, `AUK-${crypto.randomUUID().slice(0, 4)}`);
    await addIdentity(seed.orgB.id, bAsset, productId, "connector", null);

    const c = await pool.connect();
    try {
      // SET LOCAL only takes effect inside a transaction — outside one it is a silent
      // no-op and the connection stays the table OWNER, which BYPASSES RLS. Without the
      // BEGIN this test would pass vacuously against a broken policy.
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE app_request`);
      await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [seed.orgA.id]);
      const leaked = await c.query(
        `SELECT id FROM asset_product_identities WHERE canonical_product_id = $1`,
        [productId]
      );
      expect(leaked.rowCount).toBe(0);

      // Positive control: the SAME query under org B's GUC DOES see it. Without this,
      // a policy that denied everything would also "pass".
      await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [seed.orgB.id]);
      const visible = await c.query(
        `SELECT id FROM asset_product_identities WHERE canonical_product_id = $1`,
        [productId]
      );
      expect(visible.rowCount).toBe(1);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });
});

describe("C4 — the database refuses malformed evidence", () => {
  it("an attestation MUST name a person (an unattributable assertion is not evidence)", async () => {
    const productId = await makeProduct("Acme", `Ghost ${crypto.randomUUID().slice(0, 6)}`);
    const assetId = await makeAsset(seed.orgA.id, `GHO-${crypto.randomUUID().slice(0, 4)}`);
    await expect(
      addIdentity(seed.orgA.id, assetId, productId, "attestation", null)
    ).rejects.toThrow(/asset_product_identities_attestation_actor_chk|violates check constraint/i);
  });

  it("MACHINE evidence may NOT carry a human actor — it would launder an opinion", async () => {
    const productId = await makeProduct("Acme", `Wraith ${crypto.randomUUID().slice(0, 6)}`);
    const assetId = await makeAsset(seed.orgA.id, `WRA-${crypto.randomUUID().slice(0, 4)}`);
    await expect(
      addIdentity(seed.orgA.id, assetId, productId, "connector", userOf[seed.orgA.id]!)
    ).rejects.toThrow(/asset_product_identities_attestation_actor_chk|violates check constraint/i);
  });
});
