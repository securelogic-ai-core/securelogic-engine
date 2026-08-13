/**
 * vendorTierBRls.test.ts — Stop Gate A, Tier B.
 *
 * Closes audit finding D4. `vendors`, `vendor_reviews` and all seven
 * `vendor_assurance_*` tables shipped with no row-level security, and that set
 * holds the most sensitive content in the product: the vendor register, uploaded
 * third-party SOC reports, and everything extracted from them.
 *
 * The nine tables are driven from ONE table-driven suite rather than nine
 * hand-written ones. That is deliberate: a per-table copy invites a table being
 * added to the migration and forgotten here, whereas the completeness test below
 * reads pg_class and fails if any `vendor%` table has RLS disabled — so a future
 * table cannot quietly opt out.
 *
 * Everything runs under SET ROLE app_request (NOBYPASSRLS, non-owner) inside
 * BEGIN … ROLLBACK with a transaction-local GUC. "Proven, not declared."
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let vendorA: string;
let vendorB: string;

/** Seeded row ids per org, keyed by table. */
const ids: Record<string, { a: string; b: string }> = {};

/**
 * One constraint-satisfying INSERT per table, parameterised by (org, vendor).
 * Every CHECK and FK is satisfied so the ONLY thing that can reject the row is
 * RLS — a test whose insert fails a CHECK would pass for the wrong reason.
 *
 * `deps` receives the ids already seeded for the same org, so child tables can
 * point at their parent.
 */
type Seeder = {
  table: string;
  insert: (org: string, vendor: string, deps: Record<string, string>) => [string, unknown[]];
  /** Column touched by the cross-org UPDATE probe, and a value that is legal for it. */
  updateCol: string;
  updateVal: unknown;
};

const SEEDERS: Seeder[] = [
  {
    table: "vendor_reviews",
    insert: (org, vendor) => [
      `INSERT INTO vendor_reviews (organization_id, vendor_id, status)
       VALUES ($1, $2, 'in_progress') RETURNING id`,
      [org, vendor],
    ],
    updateCol: "summary",
    updateVal: "tampered",
  },
  {
    table: "vendor_assurance_documents",
    insert: (org, vendor) => [
      // storage_key is built in JS rather than concatenated from $1: reusing the
      // same placeholder as both a uuid column and a text operand makes Postgres
      // reject the statement with "inconsistent types deduced for parameter $1".
      `INSERT INTO vendor_assurance_documents
         (organization_id, vendor_id, original_filename, byte_size, sha256,
          storage_key, mime_type, processing_status)
       VALUES ($1, $2, 'soc2.pdf', 1024, repeat('a',64), $3, 'application/pdf', 'extracted')
       RETURNING id`,
      [org, vendor, `org/${org}/vendor-assurance/seed/original.pdf`],
    ],
    updateCol: "processing_status",
    updateVal: "approved",
  },
  {
    table: "vendor_assurance_extractions",
    insert: (org, _vendor, deps) => [
      `INSERT INTO vendor_assurance_extractions
         (organization_id, document_id, model_id, prompt_version, fields)
       VALUES ($1, $2, 'test-model', 'v1', '{}'::jsonb) RETURNING id`,
      [org, deps.vendor_assurance_documents],
    ],
    updateCol: "model_id",
    updateVal: "tampered",
  },
  {
    table: "vendor_assurance_extraction_spans",
    insert: (org, _vendor, deps) => [
      `INSERT INTO vendor_assurance_extraction_spans
         (organization_id, extraction_id, field_name, char_start, char_end, quote)
       VALUES ($1, $2, 'auditor_name', 0, 10, 'Ledger & Co') RETURNING id`,
      [org, deps.vendor_assurance_extractions],
    ],
    updateCol: "quote",
    updateVal: "tampered",
  },
  {
    table: "vendor_assurance_review_decisions",
    insert: (org, _vendor, deps) => [
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision)
       VALUES ($1, $2, 'auditor_name', 'accept') RETURNING id`,
      [org, deps.vendor_assurance_extractions],
    ],
    updateCol: "reviewer_note",
    updateVal: "tampered",
  },
  {
    table: "vendor_assurance_field_overrides",
    insert: (org, _vendor, deps) => [
      `INSERT INTO vendor_assurance_field_overrides
         (organization_id, document_id, field_name, reason)
       VALUES ($1, $2, 'auditor_name', 'corrected from cover page') RETURNING id`,
      [org, deps.vendor_assurance_documents],
    ],
    updateCol: "reason",
    updateVal: "tampered",
  },
  {
    table: "vendor_assurance_cuecs",
    insert: (org, _vendor, deps) => [
      `INSERT INTO vendor_assurance_cuecs
         (organization_id, document_id, ordinal, cuec_text)
       VALUES ($1, $2, 0, 'The user entity is responsible for MFA.') RETURNING id`,
      [org, deps.vendor_assurance_documents],
    ],
    updateCol: "cuec_text",
    updateVal: "tampered",
  },
];

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the vendor Tier B RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  vendorA = await seedVendor(pool, seed.orgA.id, { name: "TierB Org A vendor" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "TierB Org B vendor" });
  ids.vendors = { a: vendorA, b: vendorB };

  // Seed as the owner (RLS bypassed), building dependency chains per org.
  const depsA: Record<string, string> = {};
  const depsB: Record<string, string> = {};
  for (const s of SEEDERS) {
    const [sqlA, paramsA] = s.insert(seed.orgA.id, vendorA, depsA);
    const [sqlB, paramsB] = s.insert(seed.orgB.id, vendorB, depsB);
    const ra = await pool.query(sqlA, paramsA);
    const rb = await pool.query(sqlB, paramsB);
    depsA[s.table] = ra.rows[0].id;
    depsB[s.table] = rb.rows[0].id;
    ids[s.table] = { a: ra.rows[0].id, b: rb.rows[0].id };
  }

  // The CUEC↔control mapping needs a control in each org.
  const ctlA = await pool.query(
    `INSERT INTO controls (organization_id, name) VALUES ($1, 'TierB Control A') RETURNING id`,
    [seed.orgA.id]
  );
  const ctlB = await pool.query(
    `INSERT INTO controls (organization_id, name) VALUES ($1, 'TierB Control B') RETURNING id`,
    [seed.orgB.id]
  );
  const mapA = await pool.query(
    `INSERT INTO vendor_assurance_cuec_control_mappings
       (organization_id, cuec_id, control_id, mapping_status, mapping_source)
     VALUES ($1, $2, $3, 'suggested', 'auto') RETURNING id`,
    [seed.orgA.id, ids.vendor_assurance_cuecs!.a, ctlA.rows[0].id]
  );
  const mapB = await pool.query(
    `INSERT INTO vendor_assurance_cuec_control_mappings
       (organization_id, cuec_id, control_id, mapping_status, mapping_source)
     VALUES ($1, $2, $3, 'suggested', 'auto') RETURNING id`,
    [seed.orgB.id, ids.vendor_assurance_cuecs!.b, ctlB.rows[0].id]
  );
  ids.vendor_assurance_cuec_control_mappings = { a: mapA.rows[0].id, b: mapB.rows[0].id };
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

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

/** Every table this suite covers, including the two seeded outside SEEDERS. */
const ALL_TABLES = [
  "vendors",
  ...SEEDERS.map((s) => s.table),
  "vendor_assurance_cuec_control_mappings",
];

describe("Stop Gate A (Tier B) — cross-org reads return nothing", () => {
  for (const table of ALL_TABLES) {
    it(`${table}: org A cannot read org B's row, and can read its own`, async () => {
      await asOrg(seed.orgA.id, async (client) => {
        const own = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [ids[table]!.a]);
        expect(own.rowCount, `${table}: org A lost sight of its OWN row`).toBe(1);

        // Explicitly asking for the other tenant's id must still return nothing.
        const cross = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [ids[table]!.b]);
        expect(cross.rowCount, `${table}: CROSS-TENANT READ`).toBe(0);
      });
    });

    it(`${table}: an unscoped SELECT never returns another org's rows`, async () => {
      await asOrg(seed.orgA.id, async (client) => {
        const all = await client.query(`SELECT organization_id FROM ${table}`);
        for (const row of all.rows) {
          expect(row.organization_id, `${table}: leaked a foreign org row`).toBe(seed.orgA.id);
        }
      });
    });
  }
});

describe("Stop Gate A (Tier B) — cross-org writes are refused", () => {
  for (const s of SEEDERS) {
    it(`${s.table}: org A cannot UPDATE org B's row`, async () => {
      await asOrg(seed.orgA.id, async (client) => {
        const r = await client.query(
          `UPDATE ${s.table} SET ${s.updateCol} = $1 WHERE id = $2`,
          [s.updateVal, ids[s.table]!.b]
        );
        expect(r.rowCount, `${s.table}: CROSS-TENANT WRITE`).toBe(0);
      });
    });

    it(`${s.table}: org A cannot DELETE org B's row`, async () => {
      await asOrg(seed.orgA.id, async (client) => {
        const r = await client.query(`DELETE FROM ${s.table} WHERE id = $1`, [ids[s.table]!.b]);
        expect(r.rowCount, `${s.table}: CROSS-TENANT DELETE`).toBe(0);
      });
    });
  }

  it("vendors: WITH CHECK rejects an INSERT stamped for another org", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      await expect(
        client.query(
          `INSERT INTO vendors (organization_id, name) VALUES ($1, 'planted')`,
          [seed.orgB.id]
        )
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("vendor_assurance_documents: WITH CHECK rejects a foreign-org INSERT", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      await expect(
        client.query(
          `INSERT INTO vendor_assurance_documents
             (organization_id, vendor_id, original_filename, byte_size, sha256,
              storage_key, mime_type, processing_status)
           VALUES ($1, $2, 'planted.pdf', 10, repeat('b',64), 'org/x/y', 'application/pdf', 'pending')`,
          [seed.orgB.id, vendorB]
        )
      ).rejects.toThrow(/row-level security/i);
    });
  });
});

describe("Stop Gate A (Tier B) — fail-closed and owner-bypass semantics", () => {
  for (const table of ALL_TABLES) {
    it(`${table}: a missing org GUC returns zero rows, never everything`, async () => {
      // Pooled app_request resets the GUC to '' between checkouts. NULLIF(...,'')
      // makes that resolve to NULL so the predicate is false. Without the guard a
      // bare ''::uuid cast raises; without the policy the caller sees every tenant.
      await asOrg(null, async (client) => {
        const r = await client.query(`SELECT id FROM ${table}`);
        expect(r.rowCount, `${table}: did not fail closed`).toBe(0);
      });
    });
  }

  it("an EMPTY-STRING GUC fails closed rather than throwing", async () => {
    await asOrg(null, async (client) => {
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const r = await client.query("SELECT id FROM vendor_assurance_documents");
      expect(r.rowCount).toBe(0);
    });
  });

  it("the owner channel still crosses orgs — NOT FORCE is deliberate", async () => {
    // pgElevated, migrations, the vendor-extraction worker's claim poll and (from
    // Phase 3) the portal's pre-org-context token lookup all depend on this.
    for (const table of ALL_TABLES) {
      const r = await pool.query(`SELECT DISTINCT organization_id FROM ${table}`);
      expect(r.rowCount, `${table}: owner can no longer see across orgs`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("Stop Gate A (Tier B) — completeness", () => {
  it("EVERY vendor-domain table has RLS enabled", async () => {
    // Reads the catalogue rather than a hand-maintained list, so a table added to
    // a future migration cannot quietly opt out of tenant isolation.
    const r = await pool.query(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND (c.relname LIKE 'vendor%')
        ORDER BY c.relname`
    );
    const unprotected = r.rows.filter((x) => x.relrowsecurity === false).map((x) => x.relname);
    expect(
      unprotected,
      "These vendor-domain tables have NO row-level security. Cross-tenant isolation " +
        "for them is application-layer only, which is not acceptable once an external " +
        "portal session can reach a handler."
    ).toEqual([]);
  });

  it("every protected table is NOT FORCE, so the owner channel keeps working", async () => {
    const r = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname LIKE 'vendor%' AND c.relforcerowsecurity = true`
    );
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });

  it("app_request holds DML on every vendor_assurance_* table", async () => {
    // Without the grant app_request gets "permission denied", which resembles
    // isolation working but is the feature broken for every tenant equally.
    // privilege_type is information_schema.character_data, which the pg driver
    // hands back as a raw '{A,B}' string when aggregated — cast to text[] so it
    // arrives as a real array.
    const r = await pool.query(
      `SELECT table_name::text AS table_name,
              array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) AS privs
         FROM information_schema.role_table_grants
        WHERE grantee = 'app_request' AND table_name LIKE 'vendor_assurance%'
        GROUP BY table_name`
    );
    const byTable = new Map(r.rows.map((x) => [x.table_name, x.privs as string[]]));
    const assuranceTables = SEEDERS.map((s) => s.table)
      .filter((t) => t.startsWith("vendor_assurance"))
      .concat("vendor_assurance_cuec_control_mappings");

    for (const t of assuranceTables) {
      expect(byTable.get(t), `${t}: no app_request grant`).toEqual(
        expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"])
      );
    }
  });
});
