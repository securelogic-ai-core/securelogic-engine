/**
 * tenantAssetResolver.test.ts — C2b resolver against real Postgres.
 *
 * Proves the C2b guarantees:
 *   - resolved: exactly one active tenant asset whose canonical name == the
 *     product → status 'resolved', one candidate, confidence + rationale + source ids;
 *   - ambiguous: two matching active assets → 'ambiguous' (→ needs_review), never
 *     an auto-pick;
 *   - no_match: product with no matching asset → 'no_match';
 *   - needs_review: a CVE-only identity (no product name) and a vendor-only
 *     (non-identifiable) identity both → 'needs_review', never a match (R2);
 *   - ORG-SCOPED: an asset in org B is never returned for org A (no cross-org).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { backfillAssetRegistry } from "../../src/api/lib/assetRegistrar.js";
import { resolveTenantAssets } from "../../src/api/lib/tenantAssetResolver.js";
import { canonicalProductIdentity } from "../../src/api/lib/canonicalProduct.js";

let seed: TestDbSeed;
let pool: Pool;

/** Create an application asset named `name` for `orgId`; returns nothing (looked
 *  up by the resolver via the registry). */
async function makeAppAsset(orgId: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name) VALUES ($1, 'application', $2)`,
    [orgId, name]
  );
  await backfillAssetRegistry(pool);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the tenant asset resolver test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("C2b — resolveTenantAssets", () => {
  it("resolves a single active asset matching the product", async () => {
    const name = `Exchange ${crypto.randomUUID().slice(0, 8)}`;
    await makeAppAsset(seed.orgA.id, name);
    const client = await pool.connect();
    try {
      const id = canonicalProductIdentity({ vendor: "Microsoft", product: name, cve: "CVE-2021-26855" });
      const out = await resolveTenantAssets(client, seed.orgA.id, id);
      expect(out.status).toBe("resolved");
      expect(out.candidates).toHaveLength(1);
      expect(out.candidates[0].confidence).toBe(100);
      expect(out.candidates[0].source_identifiers).toContain("cve:CVE-2021-26855");
      expect(out.resolver_version).toBe("tar-v1.0.0");
    } finally { client.release(); }
  });

  it("flags AMBIGUOUS (needs human review) when >1 active asset matches", async () => {
    // Two DISTINCT raw names that canonicalize identically (legal-suffix + punctuation
    // variants) — a realistic duplicate that must NOT be auto-resolved to one asset.
    const base = `Ambig ${crypto.randomUUID().slice(0, 8)}`;
    await makeAppAsset(seed.orgA.id, base);            // "Ambig xxxx"
    await makeAppAsset(seed.orgA.id, `${base}, Inc.`); // canonicalizes to the same token
    const client = await pool.connect();
    try {
      const out = await resolveTenantAssets(client, seed.orgA.id, canonicalProductIdentity({ product: base }));
      expect(out.status).toBe("ambiguous");
      expect(out.candidates.length).toBeGreaterThanOrEqual(2);
    } finally { client.release(); }
  });

  it("returns no_match when no active asset matches the product", async () => {
    const client = await pool.connect();
    try {
      const out = await resolveTenantAssets(client, seed.orgA.id, canonicalProductIdentity({ product: `Nonexistent ${crypto.randomUUID()}` }));
      expect(out.status).toBe("no_match");
      expect(out.candidates).toHaveLength(0);
    } finally { client.release(); }
  });

  it("needs_review for a CVE-only identity (no product name) — never asserts a match (R2)", async () => {
    const client = await pool.connect();
    try {
      const out = await resolveTenantAssets(client, seed.orgA.id, canonicalProductIdentity({ vendor: "Microsoft", cve: "CVE-2021-26855" }));
      expect(out.status).toBe("needs_review");
      expect(out.reason).toBe("no_product_name_for_asset_match");
    } finally { client.release(); }
  });

  it("needs_review for a vendor-only (non-identifiable) identity — R2", async () => {
    const client = await pool.connect();
    try {
      const out = await resolveTenantAssets(client, seed.orgA.id, canonicalProductIdentity({ vendor: "Microsoft Corporation" }));
      expect(out.status).toBe("needs_review");
      expect(out.reason).toBe("not_product_identifiable");
    } finally { client.release(); }
  });

  it("is ORG-SCOPED: an asset in another org is never returned (no cross-org)", async () => {
    const name = `CrossOrg ${crypto.randomUUID().slice(0, 8)}`;
    await makeAppAsset(seed.orgB.id, name); // asset belongs to org B
    const client = await pool.connect();
    try {
      const out = await resolveTenantAssets(client, seed.orgA.id, canonicalProductIdentity({ product: name }));
      expect(out.status).toBe("no_match"); // org A cannot see org B's asset
      expect(out.candidates).toHaveLength(0);
    } finally { client.release(); }
  });
});
