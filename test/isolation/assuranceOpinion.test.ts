/**
 * assuranceOpinion.test.ts (isolation) — VA-S4 Step 4, against real Postgres.
 *
 * The unit test proves the normalizer proposes the right value. This proves the
 * DATABASE will not let a proposal become an authoritative one: an opinion
 * cannot exist without a human acceptor, and that is a CHECK rather than a
 * convention.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { ASSURANCE_OPINIONS } from "../../src/api/lib/vendorAssurance/assuranceOpinion.js";

let seed: TestDbSeed;
let pool: Pool;
let documentId: string;
let userId: string;

async function sqlstate(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (e) { return (e as { code?: string }).code; }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });
  const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Opinion vendor", criticality: "medium" });
  const user = await seedUser(pool, seed.orgA.id, { email: "opinion-reviewer@example.com" });
  userId = user.id;
  const d = await pool.query<{ id: string }>(
    // byte_size and sha256 are NOT NULL with no default — the upload path
    // computes them, and a direct insert has to as well.
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256,
        storage_key, mime_type, processing_status)
     VALUES ($1, $2, 'soc2.pdf', 1024, repeat('a', 64), 'k/soc2.pdf', 'application/pdf', 'extracted')
     RETURNING id`,
    [seed.orgA.id, vendorId]
  );
  documentId = d.rows[0]!.id;
}, 180_000);

afterAll(async () => { await pool?.end(); });

const setOpinion = (opinion: string | null, acceptedBy: string | null, acceptedAt: string | null) =>
  pool.query(
    `UPDATE vendor_assurance_documents
        SET assurance_opinion = $1,
            assurance_opinion_accepted_by_user_id = $2,
            assurance_opinion_accepted_at = $3::timestamptz
      WHERE id = $4`,
    [opinion, acceptedBy, acceptedAt, documentId]
  );

describe("the vocabulary is closed, and pinned to the code", () => {
  it("the CHECK list equals ASSURANCE_OPINIONS, read from pg_constraint", async () => {
    const r = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'vendor_assurance_documents_assurance_opinion_check'`
    );
    expect(r.rowCount).toBe(1);
    const inDb = [...new Set([...r.rows[0]!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!))].sort();
    expect(inDb).toEqual([...ASSURANCE_OPINIONS].sort());
  });

  it("a value outside the vocabulary is refused", async () => {
    expect(await sqlstate(setOpinion("clean", userId, "now()"))).toBe("23514");
  });
});

describe("authority is structural, not conventional", () => {
  it("an opinion WITHOUT an acceptor is refused", async () => {
    expect(await sqlstate(setOpinion("unmodified", null, null))).toBe("23514");
  });

  it("an opinion with a timestamp but no acceptor is refused", async () => {
    expect(await sqlstate(setOpinion("unmodified", null, "2026-08-29T00:00:00Z"))).toBe("23514");
  });

  it("an opinion with an acceptor but no timestamp is refused", async () => {
    expect(await sqlstate(setOpinion("unmodified", userId, null))).toBe("23514");
  });

  it("a fully governed accept is permitted", async () => {
    expect(await sqlstate(setOpinion("qualified", userId, "2026-08-29T00:00:00Z"))).toBeUndefined();
    const r = await pool.query<{ o: string; by: string }>(
      `SELECT assurance_opinion o, assurance_opinion_accepted_by_user_id by
         FROM vendor_assurance_documents WHERE id = $1`, [documentId]
    );
    expect(r.rows[0]!.o).toBe("qualified");
    expect(r.rows[0]!.by).toBe(userId);
  });

  it("clearing the opinion must clear the acceptance too", async () => {
    expect(await sqlstate(setOpinion(null, userId, "2026-08-29T00:00:00Z"))).toBe("23514");
    expect(await sqlstate(setOpinion(null, null, null))).toBeUndefined();
  });
});

describe("the default is 'no opinion', not 'clean'", () => {
  it("a freshly created document has a NULL opinion", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Fresh vendor", criticality: "low" });
    const d = await pool.query<{ assurance_opinion: string | null }>(
      `INSERT INTO vendor_assurance_documents
         (organization_id, vendor_id, original_filename, byte_size, sha256,
          storage_key, mime_type, processing_status)
       VALUES ($1, $2, 'x.pdf', 2048, repeat('b', 64), 'k/x.pdf', 'application/pdf', 'pending')
       RETURNING assurance_opinion`,
      [seed.orgA.id, vendorId]
    );
    // NULL, and NOT 'not_evaluated' — the column says nothing has been
    // established, which is the same claim but without pretending a decision
    // was recorded.
    expect(d.rows[0]!.assurance_opinion).toBeNull();
  });
});
