/**
 * canonicalProductStore.test.ts — C1b persistence against real Postgres.
 *
 * Proves the C1b guarantees:
 *   1. deterministic duplicate handling — the same identity upserts to ONE row;
 *   2. alias correctness — aliases dedupe on (product, canonical, source), and a
 *      different source is a distinct provenance row;
 *   3. no tenant leakage — the canonical_products cluster carries NO
 *      organization_id column (global reference; structurally cannot leak);
 *   4. R2 — a vendor-only identity is rejected (never stored as a product);
 *   5. external-id + version persistence with dedup.
 *
 * The tables are org-neutral (no RLS), so the test uses a plain transactional
 * client (no app_request role / org GUC) and ROLLBACKs to stay independent.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb } from "./testDb.js";
import {
  upsertCanonicalProduct,
  NotProductIdentifiableError
} from "../../src/api/lib/canonicalProductStore.js";

let pool: Pool;

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

beforeAll(async () => {
  await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the canonical product store test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("C1b — upsertCanonicalProduct (real Postgres)", () => {
  it("is deterministic: the same identity upserts to exactly one row", async () => {
    await inTx(async (client) => {
      const a = await upsertCanonicalProduct(client, {
        identity: { vendor: "Microsoft Corporation", product: "Exchange Server", cve: "CVE-2021-26855" }
      });
      const b = await upsertCanonicalProduct(client, {
        identity: { vendor: "microsoft, inc.", product: "exchange server", cve: "cve-2021-26855" }
      });
      expect(b.id).toBe(a.id); // same canonical_key → same row
      const count = await client.query("SELECT COUNT(*)::int AS n FROM canonical_products");
      expect(count.rows[0].n).toBe(1);
      expect(a.canonical_key).toBe("microsoft|exchange server|CVE-2021-26855");
    });
  });

  it("dedupes aliases on (product, canonical, source) but keeps distinct sources", async () => {
    await inTx(async (client) => {
      const p = await upsertCanonicalProduct(client, {
        identity: { vendor: "Microsoft", product: "Exchange" },
        aliases: [
          { raw: "MS Exchange", source: "kev" },
          { raw: "ms exchange", source: "kev" }, // same canonical + source → deduped
          { raw: "MS Exchange", source: "nvd" }  // different source → distinct provenance
        ]
      });
      const rows = await client.query(
        "SELECT alias_canonical, source FROM canonical_product_aliases WHERE product_id = $1 ORDER BY source",
        [p.id]
      );
      expect(rows.rows).toEqual([
        { alias_canonical: "ms exchange", source: "kev" },
        { alias_canonical: "ms exchange", source: "nvd" }
      ]);
    });
  });

  it("persists external ids (CPE optional) and versions with dedup", async () => {
    await inTx(async (client) => {
      const p = await upsertCanonicalProduct(client, {
        identity: { product: "Exchange", cve: "CVE-2021-26855" },
        externalIds: [
          { scheme: "cpe", identifier: "cpe:2.3:a:microsoft:exchange_server", source: "nvd" },
          { scheme: "cpe", identifier: "cpe:2.3:a:microsoft:exchange_server", source: "nvd" } // dedup
        ],
        versions: [{ raw: "2019 CU10", normalized: "2019.10", source: "advisory" }]
      });
      const ext = await client.query("SELECT COUNT(*)::int AS n FROM canonical_product_external_ids WHERE product_id=$1", [p.id]);
      const ver = await client.query("SELECT version_normalized FROM canonical_product_versions WHERE product_id=$1", [p.id]);
      expect(ext.rows[0].n).toBe(1);
      expect(ver.rows[0].version_normalized).toBe("2019.10");
    });
  });

  it("R2: rejects a vendor-only identity (never stored as a product)", async () => {
    await inTx(async (client) => {
      await expect(
        upsertCanonicalProduct(client, { identity: { vendor: "Microsoft Corporation" } })
      ).rejects.toBeInstanceOf(NotProductIdentifiableError);
      const count = await client.query("SELECT COUNT(*)::int AS n FROM canonical_products");
      expect(count.rows[0].n).toBe(0);
    });
  });

  it("no tenant leakage: the canonical_products cluster carries no organization_id", async () => {
    await inTx(async (client) => {
      const r = await client.query(
        `SELECT table_name FROM information_schema.columns
          WHERE column_name = 'organization_id'
            AND table_name IN ('canonical_products','canonical_product_aliases',
                               'canonical_product_external_ids','canonical_product_versions')`
      );
      expect(r.rows).toEqual([]); // structurally org-neutral — nothing to leak
    });
  });
});
