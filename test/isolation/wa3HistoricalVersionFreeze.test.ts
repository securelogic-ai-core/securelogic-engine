/**
 * wa3HistoricalVersionFreeze.test.ts — WA-3 (owner ruling 2026-09-05),
 * migration 20261091, against real Postgres.
 *
 * The freeze binds pre-P2 assessment items to question version 1 so that a
 * later canonical corpus edit cannot rewrite what a vendor was already asked.
 * Its whole value rests on four properties, and each is asserted here on live
 * rows rather than reasoned about:
 *
 *   1. ZERO vendor-visible change. What an item renders through the COALESCE
 *      fallback before the bridge must be byte-identical to what it renders
 *      through its bound version after. Proven with sha256 over the rendered
 *      pair, captured before and recomputed after.
 *   2. VERSION 1, never `current_version`. Staging's SOC 2 A1.1 carries a v2
 *      holding sabotage text from an immutability test; a bridge that bound by
 *      current_version would attach historical items to it. The fixture
 *      reproduces that exact shape.
 *   3. FAIL CLOSED. One item whose v1 no longer matches its requirement must
 *      abort the whole migration, leaving nothing bound — not be skipped.
 *   4. BOUNDED. Pre-issue engagements and items composed after the tenant's
 *      first immutable content record are NOT touched. The freeze is a
 *      one-time historical bridge, not a standing "bind anything unstamped"
 *      policy.
 *
 * Tenant isolation is asserted as a global invariant: no scope item, response
 * or revision may end up pointing at a question version owned by another org.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

const MIGRATION = readFileSync(
  resolve(process.cwd(), "db/migrations/20261091_wa3_historical_question_version_freeze.sql"),
  "utf8"
);

/** Apply the migration exactly as migrationRunner.applyMigration does. */
async function runFreeze(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(MIGRATION);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The bytes a scope item actually renders, exactly as the portal computes them:
 * COALESCE(qv.prompt, r.title) / COALESCE(qv.guidance, r.description).
 */
async function renderedHashes(orgId: string): Promise<Map<string, string>> {
  const rows = await pool.query<{ item_id: string; title: string; guidance: string | null }>(
    `SELECT si.id AS item_id,
            COALESCE(qv.prompt, r.title)          AS title,
            COALESCE(qv.guidance, r.description)  AS guidance
       FROM vendor_engagement_scope_items si
       JOIN requirements r ON r.id = si.requirement_id
       LEFT JOIN question_versions qv
              ON qv.id = si.question_version_id
             AND qv.organization_id = si.organization_id
      WHERE si.organization_id = $1
      ORDER BY si.id`,
    [orgId]
  );
  const out = new Map<string, string>();
  for (const r of rows.rows) {
    out.set(
      r.item_id,
      createHash("sha256").update(`${r.title}\u0000${r.guidance ?? "NULL"}`).digest("hex")
    );
  }
  return out;
}

type Fixture = {
  vendorId: string;
  frameworkId: string;
  /** post-issue engagement carrying the two historical items */
  engPost: string;
  /** pre-issue engagement — must never be bound */
  engPre: string;
  /** post-issue engagement whose item was composed AFTER v1 — must never be bound */
  engLate: string;
  reqPlain: string;
  reqTrap: string;
  reqLate: string;
  itemPlain: string;
  itemTrap: string;
  itemPre: string;
  itemLate: string;
  v1Plain: string;
  v1Trap: string;
  v2Trap: string;
  v1Late: string;
  responsePlain: string;
  responseTrap: string;
};

let hex = 0;
const contentHash = () => (hex++).toString(16).padStart(64, "b");

/** Deliberately awkward: an em-dash, a double space and a trailing space, so a
 *  bridge that "helpfully" normalised anything would fail the hash arms. */
const PLAIN_TITLE = "Manages capacity  demand";
const PLAIN_GUIDANCE = "You must plan capacity — not wait. ";

async function seedHistorical(orgId: string, label: string): Promise<Fixture> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );
  const frameworkId = fw.rows[0]!.id;

  const requirement = async (ref: string, title: string, description: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO requirements (framework_id, reference_id, title, description)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [frameworkId, ref, title, description]
      )
    ).rows[0]!.id;

  const reqPlain = await requirement("A1.1", PLAIN_TITLE, PLAIN_GUIDANCE);
  const reqTrap = await requirement("CC6.1", "Implements logical access security", "Least privilege applies.");
  const reqLate = await requirement("CC7.2", "Monitors infrastructure", "Monitoring applies.");

  /** A bridge question keyed exactly as bridgeQuestionKey() builds it. */
  const bridgeQuestion = async (ref: string, currentVersion: number) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO questions
           (organization_id, question_key, domain, origin, template_key, status, current_version)
         VALUES ($1, $2, 'security', 'securelogic', 'bridge', 'active', $3) RETURNING id`,
        [orgId, `req:${frameworkId}:${ref.toLowerCase()}`, currentVersion]
      )
    ).rows[0]!.id;

  const version = async (
    questionId: string,
    v: number,
    prompt: string,
    guidance: string | null
  ) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO question_versions
           (organization_id, question_id, version, prompt, guidance, answer_type,
            evidence_policy, content_hash)
         VALUES ($1, $2, $3, $4, $5, 'attest', 'optional', $6) RETURNING id`,
        [orgId, questionId, v, prompt, guidance, contentHash()]
      )
    ).rows[0]!.id;

  // The tenant's FIRST immutable content records are published here, at NOW().
  // Everything composed before this instant is the historical population.
  const qPlain = await bridgeQuestion("A1.1", 1);
  const v1Plain = await version(qPlain, 1, PLAIN_TITLE, PLAIN_GUIDANCE);

  // The A1.1 trap, reproduced: v1 matches the requirement, v2 does not, and
  // current_version points at v2.
  const qTrap = await bridgeQuestion("CC6.1", 2);
  const v1Trap = await version(qTrap, 1, "Implements logical access security", "Least privilege applies.");
  const v2Trap = await version(
    qTrap,
    2,
    "Implements logical access security",
    "EDITED AFTER ISSUE — this text must NOT reach the issued questionnaire."
  );

  const qLate = await bridgeQuestion("CC7.2", 1);
  const v1Late = await version(qLate, 1, "Monitors infrastructure", "Monitoring applies.");

  const engagement = async (status: string, title: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO vendor_engagements
           (organization_id, vendor_id, engagement_type, status, methodology_version,
            scope_rule_version, title)
         VALUES ($1, $2, 'initial', $3, '1.0.0', '1.0.0', $4) RETURNING id`,
        [orgId, vendorId, status, title]
      )
    ).rows[0]!.id;

  const engPost = await engagement("submitted", `${label} post-issue`);
  const engPre = await engagement("scoped", `${label} pre-issue`);
  const engLate = await engagement("submitted", `${label} late`);

  /** An UNSTAMPED scope item, composed at `createdAt` (a SQL interval expression). */
  const item = async (engagementId: string, requirementId: string, createdAt: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO vendor_engagement_scope_items
           (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons, created_at)
         VALUES ($1, $2, $3, 'full', TRUE, 'deterministic',
                 '[{"rule_id":"S1.baseline","rule_family":"S1","rationale":"Baseline."}]'::jsonb,
                 ${createdAt})
         RETURNING id`,
        [orgId, engagementId, requirementId]
      )
    ).rows[0]!.id;

  const BEFORE = "now() - interval '10 days'";
  const AFTER = "now() + interval '1 hour'";

  const itemPlain = await item(engPost, reqPlain, BEFORE);
  const itemTrap = await item(engPost, reqTrap, BEFORE);
  // Decoy 1: pre-issue engagement. Recomposes on its own; must not be bound.
  const itemPre = await item(engPre, reqPlain, BEFORE);
  // Decoy 2: composed AFTER the tenant's first immutable content record.
  const itemLate = await item(engLate, reqLate, AFTER);

  const response = async (engagementId: string, requirementId: string, status: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO requirement_responses
           (organization_id, requirement_id, assessment_type, subject_id, status, engagement_id, notes)
         VALUES ($1, $2, 'vendor', $3, $4, $5, 'Vendor statement.') RETURNING id`,
        [orgId, requirementId, vendorId, status, engagementId]
      )
    ).rows[0]!.id;

  const responsePlain = await response(engPost, reqPlain, "partial");
  const responseTrap = await response(engPost, reqTrap, "pass");

  for (const responseId of [responsePlain, responseTrap]) {
    await pool.query(
      `INSERT INTO requirement_response_revisions
         (organization_id, response_id, status, notes, responder_type)
       VALUES ($1, $2, 'partial', 'First pass.', 'vendor')`,
      [orgId, responseId]
    );
  }

  return {
    vendorId,
    frameworkId,
    engPost,
    engPre,
    engLate,
    reqPlain,
    reqTrap,
    reqLate,
    itemPlain,
    itemTrap,
    itemPre,
    itemLate,
    v1Plain,
    v1Trap,
    v2Trap,
    v1Late,
    responsePlain,
    responseTrap,
  };
}

let fxA: Fixture;
let fxB: Fixture;
let beforeA: Map<string, string>;
let beforeB: Map<string, string>;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
  fxA = await seedHistorical(seed.orgA.id, "wa3-a");
  fxB = await seedHistorical(seed.orgB.id, "wa3-b");
  beforeA = await renderedHashes(seed.orgA.id);
  beforeB = await renderedHashes(seed.orgB.id);
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

const stampOf = async (itemId: string): Promise<string | null> =>
  (
    await pool.query<{ question_version_id: string | null }>(
      `SELECT question_version_id FROM vendor_engagement_scope_items WHERE id = $1`,
      [itemId]
    )
  ).rows[0]!.question_version_id;

describe("WA-3 historical freeze — fail closed", () => {
  it("refuses the WHOLE migration when one item's v1 no longer matches, and binds nothing", async () => {
    // Drift exactly one requirement so its v1 guidance is no longer the text
    // the item renders. This is the "cannot establish the content" case.
    await pool.query(`UPDATE requirements SET description = 'DRIFTED' WHERE id = $1`, [fxA.reqPlain]);

    await expect(runFreeze()).rejects.toThrow(/WA-3 freeze refused/);

    // Nothing anywhere — not the drifted item, not its clean neighbour, and
    // not the other tenant, which had no drift at all.
    for (const id of [fxA.itemPlain, fxA.itemTrap, fxB.itemPlain, fxB.itemTrap]) {
      expect(await stampOf(id)).toBeNull();
    }
    const responses = await pool.query<{ n: string }>(
      `SELECT COUNT(question_version_id)::text AS n FROM requirement_responses`
    );
    expect(responses.rows[0]!.n).toBe("0");

    await pool.query(`UPDATE requirements SET description = $2 WHERE id = $1`, [
      fxA.reqPlain,
      PLAIN_GUIDANCE,
    ]);
  });
});

describe("WA-3 historical freeze — the bridge", () => {
  it("binds the historical population and changes not one rendered byte", async () => {
    await runFreeze();

    // 1. The two historical items are bound.
    expect(await stampOf(fxA.itemPlain)).toBe(fxA.v1Plain);
    expect(await stampOf(fxB.itemPlain)).toBe(fxB.v1Plain);

    // 2. VERSION 1 — not current_version, which is 2 and holds the sabotage text.
    expect(await stampOf(fxA.itemTrap)).toBe(fxA.v1Trap);
    expect(await stampOf(fxA.itemTrap)).not.toBe(fxA.v2Trap);
    expect(await stampOf(fxB.itemTrap)).toBe(fxB.v1Trap);

    // 3. Bounded: neither decoy is touched.
    expect(await stampOf(fxA.itemPre)).toBeNull();
    expect(await stampOf(fxA.itemLate)).toBeNull();
    expect(await stampOf(fxB.itemPre)).toBeNull();
    expect(await stampOf(fxB.itemLate)).toBeNull();

    // 4. ZERO vendor-visible change, for EVERY item in both tenants.
    expect(await renderedHashes(seed.orgA.id)).toEqual(beforeA);
    expect(await renderedHashes(seed.orgB.id)).toEqual(beforeB);
  });

  it("binds the answers and their revisions to the same frozen version", async () => {
    const responses = await pool.query<{
      id: string;
      question_version_id: string | null;
      status: string;
      notes: string | null;
    }>(
      `SELECT id, question_version_id, status, notes FROM requirement_responses
        WHERE id = ANY($1)`,
      [[fxA.responsePlain, fxA.responseTrap]]
    );
    const byId = new Map(responses.rows.map((r) => [r.id, r]));
    expect(byId.get(fxA.responsePlain)!.question_version_id).toBe(fxA.v1Plain);
    expect(byId.get(fxA.responseTrap)!.question_version_id).toBe(fxA.v1Trap);

    // The answer itself is untouched — only the version pointer was written.
    expect(byId.get(fxA.responsePlain)!.status).toBe("partial");
    expect(byId.get(fxA.responsePlain)!.notes).toBe("Vendor statement.");

    const revisions = await pool.query<{ question_version_id: string | null }>(
      `SELECT rev.question_version_id FROM requirement_response_revisions rev
        WHERE rev.response_id = ANY($1)`,
      [[fxA.responsePlain, fxA.responseTrap]]
    );
    expect(revisions.rowCount).toBe(2);
    expect(revisions.rows.every((r) => r.question_version_id !== null)).toBe(true);
  });

  it("leaves engagement lifecycle state exactly as it was", async () => {
    const states = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM vendor_engagements WHERE id = ANY($1)`,
      [[fxA.engPost, fxA.engPre, fxA.engLate]]
    );
    const byId = new Map(states.rows.map((r) => [r.id, r.status]));
    expect(byId.get(fxA.engPost)).toBe("submitted");
    expect(byId.get(fxA.engPre)).toBe("scoped");
    expect(byId.get(fxA.engLate)).toBe("submitted");
  });

  it("never binds a row to another tenant's content version", async () => {
    const leaks = await pool.query<{ n: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM vendor_engagement_scope_items si
            JOIN question_versions qv ON qv.id = si.question_version_id
           WHERE qv.organization_id <> si.organization_id)
       + (SELECT COUNT(*) FROM requirement_responses rr
            JOIN question_versions qv ON qv.id = rr.question_version_id
           WHERE qv.organization_id <> rr.organization_id)
       + (SELECT COUNT(*) FROM requirement_response_revisions rev
            JOIN question_versions qv ON qv.id = rev.question_version_id
           WHERE qv.organization_id <> rev.organization_id)
       )::text AS n`
    );
    expect(leaks.rows[0]!.n).toBe("0");
  });

  it("is idempotent — a second run is a no-op, not a re-bind", async () => {
    const snapshot = await renderedHashes(seed.orgA.id);
    await runFreeze();
    expect(await renderedHashes(seed.orgA.id)).toEqual(snapshot);
    expect(await stampOf(fxA.itemPlain)).toBe(fxA.v1Plain);
    expect(await stampOf(fxA.itemPre)).toBeNull();
  });

  it("freezes the content against a later canonical corpus edit — the whole point", async () => {
    const frozen = await renderedHashes(seed.orgA.id);

    // The WA-3 rulings 2/3/4 edit, simulated: the canonical requirement text
    // changes underneath an assessment that has already been answered.
    await pool.query(
      `UPDATE requirements SET title = 'REWRITTEN TITLE', description = 'Rewritten guidance.' WHERE id = $1`,
      [fxA.reqPlain]
    );

    const after = await renderedHashes(seed.orgA.id);
    // The bound historical item does not move...
    expect(after.get(fxA.itemPlain)).toBe(frozen.get(fxA.itemPlain));
    // ...while the pre-issue item, deliberately left unbound, follows the edit.
    expect(after.get(fxA.itemPre)).not.toBe(frozen.get(fxA.itemPre));

    await pool.query(`UPDATE requirements SET title = $2, description = $3 WHERE id = $1`, [
      fxA.reqPlain,
      PLAIN_TITLE,
      PLAIN_GUIDANCE,
    ]);
  });
});
