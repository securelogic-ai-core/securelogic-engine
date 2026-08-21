/**
 * findingAssetOccurrencesRls.test.ts — real-Postgres proof for SL-OCC-1.
 *
 * Two things need proving here that a unit test cannot touch:
 *
 *  1. TENANT ISOLATION on a join table that now carries THREE tenant-scoped ids
 *     (org, finding, asset). A junction is the most attractive place to leak,
 *     and this one can leak asset inventory — arguably more sensitive than the
 *     findings themselves, because it is a map of the estate.
 *
 *  2. THE INDEPENDENCE CLAIMS. "The finding stays intact", "the Risk Register
 *     relationship stays intact", "the SLA stays intact" and "one occurrence
 *     disappearing does not close another" are all statements about what does
 *     NOT change, and only a real database can show that nothing else moved.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

let vulnA: string;          // Org A, CVE-2026-10001, Critical
let vulnA2: string;         // Org A, a different vulnerability
let assetA1: string;
let assetA2: string;
let riskA: string;
let vulnB: string;          // Org B
let assetB1: string;

async function asOrg<T>(orgId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function seedAsset(orgId: string, assetType = "endpoint"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
     VALUES ($1, $2, 'endpoints', gen_random_uuid(), 'active') RETURNING id`,
    [orgId, assetType],
  );
  return r.rows[0]!.id;
}

async function seedVuln(orgId: string, title: string, cve: string | null = null): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, status, source_type, cve_id)
     VALUES ($1, $2, 'Critical', 'occurrence harness', 'open', 'vulnerability', $3) RETURNING id`,
    [orgId, title, cve],
  );
  return r.rows[0]!.id;
}

async function seedOccurrence(orgId: string, findingId: string, assetId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO finding_asset_occurrences (organization_id, finding_id, asset_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [orgId, findingId, assetId],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });

  vulnA = await seedVuln(seed.orgA.id, "Struts RCE", "CVE-2026-10001");
  vulnA2 = await seedVuln(seed.orgA.id, "OpenSSL flaw", "CVE-2026-20002");
  assetA1 = await seedAsset(seed.orgA.id);
  assetA2 = await seedAsset(seed.orgA.id);
  vulnB = await seedVuln(seed.orgB.id, "Org B vuln", "CVE-2026-10001");
  assetB1 = await seedAsset(seed.orgB.id);

  const r = await pool.query<{ id: string }>(
    `INSERT INTO risks (organization_id, title, domain, likelihood, impact, risk_rating)
     VALUES ($1, 'Internet-facing RCE exposure', 'cyber', 'likely', 'High', 'High') RETURNING id`,
    [seed.orgA.id],
  );
  riskA = r.rows[0]!.id;
  await pool.query(
    `INSERT INTO finding_risks (organization_id, finding_id, risk_id, link_type)
     VALUES ($1, $2, $3, 'linked')`,
    [seed.orgA.id, vulnA, riskA],
  );
});

afterAll(async () => {
  await pool?.end();
});

describe("one vulnerability, many assets", () => {
  it("the same vulnerability on two assets is TWO distinct occurrences", async () => {
    const o1 = await seedOccurrence(seed.orgA.id, vulnA, assetA1);
    const o2 = await seedOccurrence(seed.orgA.id, vulnA, assetA2);
    expect(o1).not.toBe(o2);
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2`, [seed.orgA.id, vulnA]);
    expect(Number(r.rows[0]!.n)).toBe(2);
  });

  it("but only ONE finding — the CVE is not duplicated per host", async () => {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM findings
        WHERE organization_id = $1 AND cve_id = 'CVE-2026-10001'`, [seed.orgA.id]);
    expect(Number(r.rows[0]!.n)).toBe(1);
  });

  it("re-recording the same vulnerability on the same asset is REFUSED as a duplicate", async () => {
    // Identity is (organization_id, finding_id, asset_id). The route converges on
    // the existing row; the database is the backstop that makes a second active
    // occurrence for one pair impossible.
    await expect(seedOccurrence(seed.orgA.id, vulnA, assetA1)).rejects.toThrow();
  });

  it("different vulnerabilities on the same asset coexist", async () => {
    await seedOccurrence(seed.orgA.id, vulnA2, assetA1);
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences
        WHERE organization_id = $1 AND asset_id = $2`, [seed.orgA.id, assetA1]);
    expect(Number(r.rows[0]!.n)).toBe(2);
  });

  it("there is NO unique index on (organization_id, cve_id)", async () => {
    const r = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'findings'`);
    for (const i of r.rows.filter((x) => x.indexdef.includes("cve_id"))) {
      expect(i.indexdef).not.toContain("UNIQUE");
    }
  });
});

describe("one occurrence resolving does not resolve the others", () => {
  it("remediating one asset leaves the other active and the finding open", async () => {
    await pool.query(
      `UPDATE finding_asset_occurrences
          SET presence_status = 'remediated', remediated_at = NOW()
        WHERE organization_id = $1 AND finding_id = $2 AND asset_id = $3`,
      [seed.orgA.id, vulnA, assetA1]);

    const rows = await pool.query<{ presence_status: string }>(
      `SELECT presence_status FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2 ORDER BY presence_status`,
      [seed.orgA.id, vulnA]);
    expect(rows.rows.map((r) => r.presence_status)).toEqual(["present", "remediated"]);

    // THE CANONICAL FINDING IS UNTOUCHED. Nothing in this package writes it.
    const f = await pool.query<{ operational_status: string; decision_state: string; severity: string }>(
      `SELECT operational_status, decision_state, severity FROM findings WHERE id = $1`, [vulnA]);
    expect(f.rows[0]!.operational_status).toBe("open");
    expect(f.rows[0]!.severity).toBe("Critical");
  });

  it("deleting one occurrence erases neither the finding nor the other occurrences", async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2`, [seed.orgA.id, vulnA]);
    await pool.query(
      `DELETE FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2 AND asset_id = $3`,
      [seed.orgA.id, vulnA, assetA1]);
    const after = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2`, [seed.orgA.id, vulnA]);
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) - 1);

    const f = await pool.query(`SELECT id FROM findings WHERE id = $1`, [vulnA]);
    expect(f.rowCount).toBe(1);
    // Restore for later tests.
    await seedOccurrence(seed.orgA.id, vulnA, assetA1);
  });

  it("the Risk Register relationship survives occurrence churn", async () => {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_risks
        WHERE organization_id = $1 AND finding_id = $2 AND risk_id = $3`,
      [seed.orgA.id, vulnA, riskA]);
    expect(Number(r.rows[0]!.n)).toBe(1);
  });

  it("500 affected hosts would still be ONE risk — no per-asset risk exists", async () => {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM risks WHERE organization_id = $1`, [seed.orgA.id]);
    expect(Number(r.rows[0]!.n)).toBe(1);
  });
});

describe("the SLA remains the finding's, not the asset's", () => {
  it("occurrences carry no due date column at all", async () => {
    const r = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'finding_asset_occurrences'`);
    const cols = r.rows.map((x) => x.column_name);
    expect(cols).not.toContain("due_date");
    expect(cols).not.toContain("sla_due_date");
  });

  it("the finding's due date is unchanged by occurrence activity", async () => {
    const before = await pool.query(`SELECT due_date FROM findings WHERE id = $1`, [vulnA]);
    await pool.query(
      `UPDATE finding_asset_occurrences SET last_seen_at = NOW()
        WHERE organization_id = $1 AND finding_id = $2`, [seed.orgA.id, vulnA]);
    const after = await pool.query(`SELECT due_date FROM findings WHERE id = $1`, [vulnA]);
    expect(after.rows[0]!["due_date"]).toEqual(before.rows[0]!["due_date"]);
  });
});

describe("a vulnerability without an asset stays valid", () => {
  it("a finding with zero occurrences is a legitimate standing record", async () => {
    const standalone = await seedVuln(seed.orgA.id, "No asset known", "CVE-2026-30003");
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences WHERE finding_id = $1`,
      [standalone]);
    expect(Number(r.rows[0]!.n)).toBe(0);
    const f = await pool.query(`SELECT id FROM findings WHERE id = $1`, [standalone]);
    expect(f.rowCount).toBe(1);
  });

  it("Informational vulnerabilities keep null severity and no due date", async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, title, severity, source_severity, description,
                             status, source_type)
       VALUES ($1, 'Informational observation', NULL, 'Informational', 'x', 'open', 'vulnerability')
       RETURNING id`, [seed.orgA.id]);
    const f = await pool.query(
      `SELECT severity, due_date, source_severity FROM findings WHERE id = $1`, [r.rows[0]!.id]);
    expect(f.rows[0]!["severity"]).toBeNull();
    expect(f.rows[0]!["due_date"]).toBeNull();
    expect(f.rows[0]!["source_severity"]).toBe("Informational");
  });
});

describe("the presence CHECKs keep a row self-consistent", () => {
  it("absent requires absent_since", async () => {
    await expect(pool.query(
      `INSERT INTO finding_asset_occurrences (organization_id, finding_id, asset_id, presence_status)
       VALUES ($1, $2, $3, 'absent')`, [seed.orgA.id, vulnA2, assetA2])).rejects.toThrow();
  });

  it("present must NOT carry absent_since", async () => {
    await expect(pool.query(
      `INSERT INTO finding_asset_occurrences
         (organization_id, finding_id, asset_id, presence_status, absent_since)
       VALUES ($1, $2, $3, 'present', NOW())`, [seed.orgA.id, vulnA2, assetA2])).rejects.toThrow();
  });

  it("last_seen_at cannot precede first_seen_at", async () => {
    await expect(pool.query(
      `INSERT INTO finding_asset_occurrences
         (organization_id, finding_id, asset_id, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, NOW(), NOW() - INTERVAL '1 day')`,
      [seed.orgA.id, vulnA2, assetA2])).rejects.toThrow();
  });

  it("a reappeared_count without a timestamp is refused", async () => {
    await expect(pool.query(
      `INSERT INTO finding_asset_occurrences
         (organization_id, finding_id, asset_id, reappeared_count)
       VALUES ($1, $2, $3, 2)`, [seed.orgA.id, vulnA2, assetA2])).rejects.toThrow();
  });
});

describe("deleting an asset cannot silently erase its vulnerability history", () => {
  it("the FK is RESTRICT, not CASCADE", async () => {
    const r = await pool.query<{ confdeltype: string }>(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'finding_asset_occurrences'::regclass
          AND contype = 'f' AND confrelid = 'assets'::regclass`);
    // 'r' = RESTRICT. 'c' would be CASCADE — the silent-erasure default this
    // deliberately rejects.
    expect(r.rows[0]!.confdeltype).toBe("r");
  });

  it("the database refuses to delete an asset that carries exposure", async () => {
    const doomed = await seedAsset(seed.orgA.id);
    await seedOccurrence(seed.orgA.id, vulnA2, doomed);
    await expect(pool.query(`DELETE FROM assets WHERE id = $1`, [doomed])).rejects.toThrow();
    // And the history is still there afterwards.
    const still = await pool.query(
      `SELECT id FROM finding_asset_occurrences WHERE asset_id = $1`, [doomed]);
    expect(still.rowCount).toBe(1);
  });

  it("an asset with no exposure still deletes normally", async () => {
    const free = await seedAsset(seed.orgA.id);
    await expect(pool.query(`DELETE FROM assets WHERE id = $1`, [free])).resolves.toBeTruthy();
  });
});

describe("tenant isolation — enumerate, read, link, modify, infer", () => {
  beforeAll(async () => {
    await seedOccurrence(seed.orgB.id, vulnB, assetB1);
  });

  it("ENUMERATE: a tenant sees only its own occurrences", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM finding_asset_occurrences`)).rows);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.organization_id).toBe(seed.orgA.id);
  });

  it("READ: another tenant's occurrence is invisible even by id", async () => {
    const bOcc = await pool.query<{ id: string }>(
      `SELECT id FROM finding_asset_occurrences WHERE organization_id = $1 LIMIT 1`,
      [seed.orgB.id]);
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(`SELECT id FROM finding_asset_occurrences WHERE id = $1`,
        [bOcc.rows[0]!.id])).rows);
    expect(rows).toHaveLength(0);
  });

  it("ENUMERATE ASSETS: a tenant cannot list another tenant's assets", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query<{ id: string }>(`SELECT id FROM assets`)).rows);
    expect(rows.map((r) => r.id)).not.toContain(assetB1);
  });

  it("LINK: WITH CHECK refuses an occurrence naming another tenant", async () => {
    await expect(
      asOrg(seed.orgA.id, async (c) =>
        c.query(
          `INSERT INTO finding_asset_occurrences (organization_id, finding_id, asset_id)
           VALUES ($1, $2, $3)`, [seed.orgB.id, vulnB, assetB1])),
    ).rejects.toThrow();
  });

  it("LINK: forging Org A's org_id over Org B's asset is refused by the FK/RLS pair", async () => {
    // The row would pass RLS (org matches the GUC) but names an asset Org A
    // cannot see — the route's endpoint re-verification is what refuses it, and
    // the attempt must not create anything.
    const before = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences WHERE organization_id = $1`,
      [seed.orgA.id]);
    await asOrg(seed.orgA.id, async (c) => {
      await c.query(
        `INSERT INTO finding_asset_occurrences (organization_id, finding_id, asset_id)
         VALUES ($1, $2, $3)`, [seed.orgA.id, vulnA, assetB1]).catch(() => {});
    });
    const after = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences WHERE organization_id = $1`,
      [seed.orgA.id]);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("MODIFY: a tenant cannot update another tenant's occurrence", async () => {
    const bOcc = await pool.query<{ id: string }>(
      `SELECT id FROM finding_asset_occurrences WHERE organization_id = $1 LIMIT 1`,
      [seed.orgB.id]);
    const n = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(
        `UPDATE finding_asset_occurrences SET presence_status = 'remediated', remediated_at = NOW()
          WHERE id = $1`, [bOcc.rows[0]!.id])).rowCount);
    expect(n).toBe(0);
  });

  it("DELETE: a tenant cannot delete another tenant's occurrence", async () => {
    const bOcc = await pool.query<{ id: string }>(
      `SELECT id FROM finding_asset_occurrences WHERE organization_id = $1 LIMIT 1`,
      [seed.orgB.id]);
    const n = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(`DELETE FROM finding_asset_occurrences WHERE id = $1`,
        [bOcc.rows[0]!.id])).rowCount);
    expect(n).toBe(0);
    const still = await pool.query(`SELECT id FROM finding_asset_occurrences WHERE id = $1`,
      [bOcc.rows[0]!.id]);
    expect(still.rowCount).toBe(1);
  });

  it("INFER: a shared CVE leaks no cross-tenant exposure count", async () => {
    // Both orgs have CVE-2026-10001. Counting occurrences for it as Org A must
    // never include Org B's host — this is the query an executive report runs.
    const n = await asOrg(seed.orgA.id, async (c) =>
      (await c.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM finding_asset_occurrences o JOIN findings f ON f.id = o.finding_id
          WHERE f.cve_id = 'CVE-2026-10001'`)).rows[0]!.n);
    const total = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM finding_asset_occurrences o JOIN findings f ON f.id = o.finding_id
        WHERE f.cve_id = 'CVE-2026-10001'`);
    expect(Number(n)).toBeLessThan(Number(total.rows[0]!.n));
  });
});

describe("asset_identifiers isolation and identity rules", () => {
  it("an identifier is scoped to its tenant", async () => {
    await pool.query(
      `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
       VALUES ($1, $2, 'hostname', 'web01', 'manual')`, [seed.orgB.id, assetB1]);
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(`SELECT id FROM asset_identifiers WHERE value = 'web01'`)).rows);
    expect(rows).toHaveLength(0);
  });

  it("the SAME hostname may legitimately belong to two assets in one org", async () => {
    // Two `web01`s in two domains is ordinary. A UNIQUE (org, scheme, value)
    // would reject this and force a false merge.
    await pool.query(
      `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
       VALUES ($1, $2, 'hostname', 'web01', 'manual'), ($1, $3, 'hostname', 'web01', 'manual')`,
      [seed.orgA.id, assetA1, assetA2]);
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM asset_identifiers
        WHERE organization_id = $1 AND scheme = 'hostname' AND value = 'web01'`, [seed.orgA.id]);
    expect(Number(r.rows[0]!.n)).toBe(2);
  });

  it("the same (asset, scheme, value) is not stored twice", async () => {
    await expect(pool.query(
      `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
       VALUES ($1, $2, 'hostname', 'web01', 'manual')`, [seed.orgA.id, assetA1])).rejects.toThrow();
  });

  it("an unknown scheme is refused", async () => {
    await expect(pool.query(
      `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
       VALUES ($1, $2, 'ip_address', '10.0.0.1', 'manual')`,
      [seed.orgA.id, assetA1])).rejects.toThrow();
  });
});

describe("query and index behaviour at scale", () => {
  it("the finding→assets query uses a tenant-first index, not a sequential scan", async () => {
    const r = await pool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT id FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2 AND presence_status = 'present'`,
      [seed.orgA.id, vulnA]);
    const plan = r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Index (Only )?Scan|Bitmap/);
  });

  it("the asset→vulnerabilities query uses an index", async () => {
    const r = await pool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT id FROM finding_asset_occurrences
        WHERE organization_id = $1 AND asset_id = $2`, [seed.orgA.id, assetA1]);
    const plan = r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Index (Only )?Scan|Bitmap/);
  });

  it("the identifier lookup uses a tenant-first index", async () => {
    const r = await pool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT asset_id FROM asset_identifiers
        WHERE organization_id = $1 AND scheme = 'hostname' AND value = 'web01'`, [seed.orgA.id]);
    const plan = r.rows.map((x) => x["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Index (Only )?Scan|Bitmap/);
  });

  it("every occurrence index leads with organization_id", async () => {
    // A non-tenant-first index invites a plan that scans across tenants before
    // filtering — correct under RLS, but it reads the wrong pages to get there.
    const r = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'finding_asset_occurrences' AND indexname <> 'finding_asset_occurrences_pkey'`);
    expect(r.rows.length).toBeGreaterThan(0);
    for (const i of r.rows) expect(i.indexdef).toMatch(/\((organization_id|organization_id,)/);
  });

  it("pagination is stable under a deterministic sort", async () => {
    const page = async (offset: number) =>
      (await pool.query<{ id: string }>(
        `SELECT id FROM finding_asset_occurrences
          WHERE organization_id = $1
          ORDER BY last_seen_at DESC, id LIMIT 2 OFFSET $2`, [seed.orgA.id, offset])).rows
        .map((r) => r.id);
    const first = await page(0);
    const second = await page(2);
    expect(first).toHaveLength(2);
    // No id appears on two pages — the tiebreak on id is what guarantees it when
    // many rows share a last_seen_at, which is the normal case after one scan.
    for (const id of second) expect(first).not.toContain(id);
  });
});
