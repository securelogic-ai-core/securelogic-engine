/**
 * assetSearchIndexView.test.ts — real-Postgres behavior of the
 * `asset_search_index_v` search projection (20260908) and the shared
 * assetSearchResolver on top of it.
 *
 * Proves, against the full migration set:
 *   1. the view projects one row per (asset, searchable term) — name for every
 *      arm, plus hostname / cloud_account / external_ref where they exist —
 *      with asset identity delegated to asset_registry_v (never re-derived);
 *   2. explicit `WHERE organization_id = $1` returns ONLY that org's terms,
 *      even when another org holds an identical hostname;
 *   3. resolveAssetSearch end-to-end: subtype identifiers (hostname, cloud
 *      account) resolve to canonical asset ids, UUID terms take the exact
 *      identity path, and type narrowing works;
 *   4. defense-in-depth: as `app_request`, RLS applies THROUGH the view
 *      (security_invoker) for the RLS-bearing endpoints arm, and the grant
 *      allows the read (A04-G1 role flip).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { resolveAssetSearch } from "../../src/api/lib/assetSearchResolver.js";

let seed: TestDbSeed;
let pool: Pool;

let vendorId: string;
let endpointId: string;
let ipEndpointId: string;
let cloudId: string;

// FQDN-shaped — the hostname column is where FQDNs live today.
const HOSTNAME = "web-01.harness.internal";
// IP-shaped — connectors that only know an address store it here too.
const IP_HOSTNAME = "10.42.7.13";

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the asset_search_index_v test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Org A inventory: one name-only asset + the subtype-identifier bearers.
  const v = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name, criticality) VALUES ($1, 'Search Vendor', 'high') RETURNING id`,
    [seed.orgA.id]
  );
  vendorId = v.rows[0].id;
  const ep = await pool.query<{ id: string }>(
    `INSERT INTO endpoints (organization_id, name, hostname, external_ref)
     VALUES ($1, 'Web Server 01', $2, 'mdm-4711') RETURNING id`,
    [seed.orgA.id, HOSTNAME]
  );
  endpointId = ep.rows[0].id;
  const ipEp = await pool.query<{ id: string }>(
    `INSERT INTO endpoints (organization_id, name, hostname) VALUES ($1, 'Legacy Appliance', $2) RETURNING id`,
    [seed.orgA.id, IP_HOSTNAME]
  );
  ipEndpointId = ipEp.rows[0].id;
  const cr = await pool.query<{ id: string }>(
    `INSERT INTO cloud_resources (organization_id, name, provider, account_id)
     VALUES ($1, 'Prod Backups Bucket', 'aws', '123456789012') RETURNING id`,
    [seed.orgA.id]
  );
  cloudId = cr.rows[0].id;

  // Alias path: an org-neutral canonical product with TWO sources claiming the
  // SAME alias string (duplicate identifier), bridged to org A's vendor asset.
  const cp = await pool.query<{ id: string }>(
    `INSERT INTO canonical_products (canonical_key, vendor_canonical, product_canonical, display_name)
     VALUES ('search vendor::searchsuite', 'search vendor', 'searchsuite', 'SearchSuite') RETURNING id`
  );
  await pool.query(
    `INSERT INTO canonical_product_aliases (product_id, alias_raw, alias_canonical, source)
     VALUES ($1, 'SrchSuite Enterprise', 'srchsuite enterprise', 'nvd'),
            ($1, 'SrchSuite Enterprise', 'srchsuite enterprise', 'vendor_feed')`,
    [cp.rows[0].id]
  );
  await pool.query(
    `INSERT INTO asset_product_identities (organization_id, asset_id, canonical_product_id, provenance, confidence)
     VALUES ($1, $2, $3, 'connector', 90)`,
    [seed.orgA.id, vendorId, cp.rows[0].id]
  );

  // Org B decoys — the IDENTICAL hostname, and the same product bridged to a
  // B asset (the alias must resolve per-org, never across).
  await pool.query(
    `INSERT INTO endpoints (organization_id, name, hostname) VALUES ($1, 'B Web Server', $2)`,
    [seed.orgB.id, HOSTNAME]
  );
  const bv = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, 'B Vendor') RETURNING id`,
    [seed.orgB.id]
  );
  await pool.query(
    `INSERT INTO asset_product_identities (organization_id, asset_id, canonical_product_id, provenance, confidence)
     VALUES ($1, $2, $3, 'connector', 90)`,
    [seed.orgB.id, bv.rows[0].id, cp.rows[0].id]
  );
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("asset_search_index_v", () => {
  it("projects one row per (asset, term) with the term_kind vocabulary", async () => {
    const r = await pool.query(
      `SELECT asset_id, asset_type, backing_kind, backing_id, term, term_kind
         FROM asset_search_index_v
        WHERE organization_id = $1
        ORDER BY term_kind, term`,
      [seed.orgA.id]
    );

    const terms = r.rows.map((x) => `${x.term_kind}:${x.term}`);
    expect(terms).toContain("name:Search Vendor");
    expect(terms).toContain("name:Web Server 01");
    expect(terms).toContain("name:Prod Backups Bucket");
    expect(terms).toContain(`hostname:${HOSTNAME}`);
    expect(terms).toContain(`hostname:${IP_HOSTNAME}`);
    expect(terms).toContain("cloud_account:123456789012");
    expect(terms).toContain("alias:SrchSuite Enterprise");
    expect(terms).toContain("external_ref:mdm-4711");

    // Asset identity is the registry's (Phase 0: backing id), so subtype terms
    // point at the SAME asset the registry lists — and both identities travel.
    const hostnameRow = r.rows.find((x) => x.term_kind === "hostname" && x.term === HOSTNAME);
    expect(hostnameRow.asset_id).toBe(endpointId);
    expect(hostnameRow.asset_type).toBe("endpoint");
    expect(hostnameRow.backing_kind).toBe("endpoints");
    expect(hostnameRow.backing_id).toBe(endpointId);

    // The alias arm points at the vendor asset the identity bridge names.
    const aliasRow = r.rows.find((x) => x.term_kind === "alias");
    expect(aliasRow.asset_id).toBe(vendorId);
    expect(aliasRow.backing_kind).toBe("vendors");
  });

  it("org predicate excludes the identical cross-org hostname", async () => {
    const r = await pool.query(
      `SELECT asset_id FROM asset_search_index_v
        WHERE organization_id = $1 AND term = $2`,
      [seed.orgA.id, HOSTNAME]
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].asset_id).toBe(endpointId);
  });
});

describe("resolveAssetSearch (end-to-end)", () => {
  it("an FQDN fragment resolves to the owning endpoint's canonical asset id", async () => {
    const r = await resolveAssetSearch(pool, seed.orgA.id, "web-01");
    expect(r.truncated).toBe(false);
    expect(r.matches).toEqual([
      {
        asset_id: endpointId,
        asset_type: "endpoint",
        backing_kind: "endpoints",
        backing_id: endpointId,
        matched_kind: "hostname"
      }
    ]);
  });

  it("an IP-shaped identifier resolves the endpoint that carries it", async () => {
    const r = await resolveAssetSearch(pool, seed.orgA.id, "10.42.7.13");
    expect(r.matches.map((m) => m.asset_id)).toEqual([ipEndpointId]);
    expect(r.matches[0].matched_kind).toBe("hostname");
  });

  it("a cloud account id resolves to the cloud resource", async () => {
    const r = await resolveAssetSearch(pool, seed.orgA.id, "123456789012");
    expect(r.matches).toEqual([
      {
        asset_id: cloudId,
        asset_type: "cloud_resource",
        backing_kind: "cloud_resources",
        backing_id: cloudId,
        matched_kind: "cloud_account"
      }
    ]);
  });

  it("a product alias resolves to the bridged vendor asset — ONE match despite duplicate alias rows", async () => {
    // The same alias string exists twice (two sources) — deterministic dedup
    // must return the asset once, and only org A's bridged asset.
    const r = await resolveAssetSearch(pool, seed.orgA.id, "SrchSuite");
    expect(r.matches).toEqual([
      {
        asset_id: vendorId,
        asset_type: "vendor",
        backing_kind: "vendors",
        backing_id: vendorId,
        matched_kind: "alias"
      }
    ]);
  });

  it("a UUID term takes the exact identity path", async () => {
    const r = await resolveAssetSearch(pool, seed.orgA.id, endpointId);
    expect(r.matches).toEqual([
      {
        asset_id: endpointId,
        asset_type: "endpoint",
        backing_kind: "endpoints",
        backing_id: endpointId,
        matched_kind: "id"
      }
    ]);
  });

  it("type narrowing keeps only the requested asset types", async () => {
    // "Server" matches the endpoint by name; narrowing to cloud_resource must
    // drop it rather than return a cross-type match.
    const r = await resolveAssetSearch(pool, seed.orgA.id, "Server", {
      assetTypes: ["cloud_resource"]
    });
    expect(r.matches).toEqual([]);
  });

  it("never returns another org's assets for the identical term", async () => {
    const r = await resolveAssetSearch(pool, seed.orgA.id, HOSTNAME);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].asset_id).toBe(endpointId);

    // The shared alias store must not leak either: B's bridge to the same
    // canonical product resolves to B's asset for B, and only B's.
    const rB = await resolveAssetSearch(pool, seed.orgB.id, "SrchSuite");
    expect(rB.matches).toHaveLength(1);
    expect(rB.matches[0].asset_id).not.toBe(vendorId);
  });
});

describe("defense-in-depth (app_request)", () => {
  it("endpoints RLS applies THROUGH the view (security_invoker)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      // No org predicate on purpose: the endpoints arm must be RLS-filtered to
      // org A even without WHERE — B's identical hostname must not appear.
      const r = await client.query(
        `SELECT asset_id FROM asset_search_index_v WHERE term = $1`,
        [HOSTNAME]
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].asset_id).toBe(endpointId);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request can read the view (grant in place for the role flip)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const r = await client.query(
        `SELECT count(*)::int AS n FROM asset_search_index_v WHERE organization_id = $1`,
        [seed.orgA.id]
      );
      expect(Number(r.rows[0].n)).toBeGreaterThanOrEqual(6);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
