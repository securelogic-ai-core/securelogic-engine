/**
 * evidenceAuthorityRepair.test.ts — S4-4C-0, against real Postgres.
 *
 * The invariant:
 *
 *   AN ASSURANCE DOCUMENT CANNOT ENTER AN ASSURANCE-ELIGIBLE APPROVED STATE
 *   WITHOUT THE REQUIRED GOVERNED REVIEW STATE.
 *
 * ── The regression being repaired ───────────────────────────────────────────
 *
 * The legacy `finalize` route required a current review decision on every
 * material extracted field. The current `approve` route — the terminal
 * assurance-eligible state, and the one the S4 predicate keys on — required
 * none. The newer state asserted LESS than the one it replaced. Measured before
 * the repair: zero review decisions existed anywhere in the estate.
 *
 * ── Two grains, and why ─────────────────────────────────────────────────────
 *
 * Review decisions were keyed by `field_name` alone, so a reviewer accepted the
 * whole `controls` ARRAY as one indivisible act. S4 reasons about each tested
 * control independently — fan-out is up to 5 requirements per control, each
 * needing its own sufficiency determination — so five controls cannot be one
 * decision. `element_key` adds that grain to the existing append-only model
 * rather than building a second one.
 */

process.env["JWT_SECRET"] ??= "test-jwt-secret-for-evidence-authority";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import crypto from "node:crypto";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { ASSURANCE_BEARING_FIELD_NAMES } from "../../src/api/lib/vendorAssuranceValidation.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let userA = "";
let jwtA = "";
let vendorA = "";

const CONTROLS = [
  { control_id: "CC6.1", description: "Access requests are approved", test_procedure: "Inspected 25", result: "No exception noted." },
  { control_id: "A1.2", description: "Backups are monitored", test_procedure: "Inspected 30", result: "Exception noted: 2 of 30 days." },
];

/** A document in `extracted` WITH an extraction — the approvable shape. */
async function docWithExtraction(label: string, controls: unknown = CONTROLS): Promise<{ documentId: string; extractionId: string }> {
  const d = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key, mime_type, processing_status)
     VALUES ($1,$2,$3,1024,$4,$5,'application/pdf','extracted') RETURNING id`,
    [seed.orgA.id, vendorA, `${label}.pdf`, crypto.createHash("sha256").update(label).digest("hex"), `k/${label}.pdf`]
  );
  const documentId = d.rows[0]!.id;
  const fields: Record<string, unknown> = { controls: { value: controls, confidence: 0.99, status: "extracted" } };
  for (const f of ASSURANCE_BEARING_FIELD_NAMES) {
    if (f !== "controls") fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }
  const e = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_extractions (organization_id, document_id, model_id, prompt_version, fields)
     VALUES ($1,$2,'test-model','v1',$3::jsonb) RETURNING id`,
    [seed.orgA.id, documentId, JSON.stringify(fields)]
  );
  return { documentId, extractionId: e.rows[0]!.id };
}

const asUser = (m: "post", p: string) => request(app)[m](p).set("Authorization", `Bearer ${jwtA}`);

const decide = (extractionId: string, decisions: unknown[]) =>
  asUser("post", `/api/vendor-assurance/extractions/${extractionId}/review-decisions`).send({ decisions });

const approve = (documentId: string) =>
  asUser("post", `/api/vendor-assurance/documents/${documentId}/approve`).send({});

const docRow = async (id: string) =>
  (await pool.query<{ processing_status: string; approved_by_user_id: string | null }>(
    `SELECT processing_status, approved_by_user_id FROM vendor_assurance_documents WHERE id = $1`, [id]
  )).rows[0]!;

/** Review every assurance-bearing field, and optionally every tested control. */
async function reviewEverything(extractionId: string, controlKeys: string[]): Promise<void> {
  const fieldDecisions = ASSURANCE_BEARING_FIELD_NAMES.map((field_name) => ({
    field_name, decision: "accept", reviewer_note: "checked",
  }));
  const r1 = await decide(extractionId, fieldDecisions);
  expect(r1.status, JSON.stringify(r1.body)).toBe(200);
  if (controlKeys.length) {
    const r2 = await decide(extractionId, controlKeys.map((element_key) => ({
      field_name: "controls", element_key, decision: "accept", reviewer_note: `reviewed ${element_key}`,
    })));
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  const u = await seedUser(pool, seed.orgA.id, { email: "evidence-reviewer@example.com" });
  userA = u.id;
  await recordAllCurrentConsents(pool, { userId: userA, organizationId: seed.orgA.id, consentMethod: "admin_recorded" });
  jwtA = signJwt(userA, seed.orgA.id, "admin");
  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Evidence authority vendor" });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 300_000);

afterAll(async () => { await pool?.end(); });

describe("S4-4C-0 · the approval authority gate", () => {
  it("an UNREVIEWED document cannot be approved — the estate-wide state before this repair", async () => {
    const { documentId } = await docWithExtraction("gate-unreviewed");
    const r = await approve(documentId);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("vendor_assurance_approval_review_incomplete");
    expect(r.body.missing_field_names).toEqual([...ASSURANCE_BEARING_FIELD_NAMES]);
    expect(r.body.unreviewed_control_keys).toEqual(["CC6.1", "A1.2"]);
    expect((await docRow(documentId)).processing_status).toBe("extracted");
  });

  it("reviewing the FIELDS is not enough — each tested control needs its own decision", async () => {
    // The case field-grain review could not express. Accepting the `controls`
    // array as a whole says nothing about the controls inside it.
    const { documentId, extractionId } = await docWithExtraction("gate-fields-only");
    await reviewEverything(extractionId, []);
    const r = await approve(documentId);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.missing_field_names).toEqual([]);
    expect(r.body.unreviewed_control_keys).toEqual(["CC6.1", "A1.2"]);
  });

  it("reviewing SOME controls is not enough", async () => {
    const { documentId, extractionId } = await docWithExtraction("gate-partial");
    await reviewEverything(extractionId, ["CC6.1"]);
    const r = await approve(documentId);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.unreviewed_control_keys).toEqual(["A1.2"]);
  });

  it("a fully reviewed document CAN be approved, and is still attributed (#947 holds)", async () => {
    const { documentId, extractionId } = await docWithExtraction("gate-complete");
    await reviewEverything(extractionId, ["CC6.1", "A1.2"]);
    const r = await approve(documentId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await docRow(documentId);
    expect(row.processing_status).toBe("approved");
    expect(row.approved_by_user_id).toBe(userA);
  });

  it("a document with NO extraction cannot be approved", async () => {
    const d = await pool.query<{ id: string }>(
      `INSERT INTO vendor_assurance_documents
         (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key, mime_type, processing_status)
       VALUES ($1,$2,'noext.pdf',1024,repeat('e',64),'k/noext.pdf','application/pdf','extracted') RETURNING id`,
      [seed.orgA.id, vendorA]
    );
    const r = await approve(d.rows[0]!.id);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.reason).toBe("no_extraction");
  });

  it("an unidentifiable tested control blocks approval — it cannot be reviewed, so it cannot be approved", async () => {
    // Otherwise the gate would be satisfiable by producing controls nobody can
    // name, which is the cheapest possible bypass.
    const { documentId, extractionId } = await docWithExtraction("gate-unidentified", [
      { control_id: "CC6.1", description: "ok" },
      { description: "no identifier at all" },
    ]);
    await reviewEverything(extractionId, ["CC6.1"]);
    const r = await approve(documentId);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.reason).toBe("unidentified_tested_controls");
    expect(r.body.unidentified_tested_control_count).toBe(1);
  });

  it("REJECT and REQUEST-MANUAL-REVIEW are unchanged — they claim no assurance eligibility", async () => {
    // Gating these would block the very workflow a reviewer uses to deal with a
    // bad extraction.
    const a = await docWithExtraction("gate-reject");
    const r1 = await asUser("post", `/api/vendor-assurance/documents/${a.documentId}/reject`).send({ reason: "illegible" });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect((await docRow(a.documentId)).processing_status).toBe("rejected");

    const b = await docWithExtraction("gate-manual");
    const r2 = await asUser("post", `/api/vendor-assurance/documents/${b.documentId}/request-manual-review`).send({ comment: "second look" });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect((await docRow(b.documentId)).processing_status).toBe("manual_review_requested");
  });

  it("HISTORICAL approvals are untouched — the gate guards the TRANSITION, not the state", async () => {
    // The two staging documents approved before this repair must stay approved.
    // Nothing here fabricates a review decision for them.
    const { documentId } = await docWithExtraction("gate-historical");
    await pool.query(
      `UPDATE vendor_assurance_documents
          SET processing_status='approved', approved_at=NOW(), approved_by_user_id=$2 WHERE id=$1`,
      [documentId, userA]
    );
    // An unrelated update to an already-approved row is not blocked.
    await pool.query(`UPDATE vendor_assurance_documents SET updated_at=NOW() WHERE id=$1`, [documentId]);
    const row = await docRow(documentId);
    expect(row.processing_status).toBe("approved");
    expect(row.approved_by_user_id).toBe(userA);
    const reviews = await pool.query(
      `SELECT 1 FROM vendor_assurance_review_decisions r
         JOIN vendor_assurance_extractions e ON e.id = r.extraction_id
        WHERE e.document_id = $1`, [documentId]
    );
    expect(reviews.rowCount).toBe(0);
  });
});

describe("S4-4C-0 · element-grain review", () => {
  it("an element decision records the key AND a by-value snapshot of what was reviewed", async () => {
    const { extractionId } = await docWithExtraction("elem-snapshot");
    const r = await decide(extractionId, [
      { field_name: "controls", element_key: "A1.2", decision: "edit",
        reviewed_value: { control_id: "A1.2", result: "corrected" }, reviewer_note: "result was misread" },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const row = (await pool.query<{ element_key: string; element_snapshot: Record<string, unknown>; decision: string; decided_by_user_id: string }>(
      `SELECT element_key, element_snapshot, decision, decided_by_user_id
         FROM vendor_assurance_review_decisions WHERE extraction_id=$1 AND element_key='A1.2'`, [extractionId]
    )).rows[0]!;
    expect(row.decision).toBe("edit");
    expect(row.decided_by_user_id).toBe(userA);
    // The ORIGINAL extracted control, not the correction — provenance of what
    // the reviewer actually saw.
    expect(row.element_snapshot["control_id"]).toBe("A1.2");
    expect(row.element_snapshot["result"]).toBe("Exception noted: 2 of 30 days.");
  });

  it("each control is an INDEPENDENT decision — accept one, reject another", async () => {
    const { extractionId } = await docWithExtraction("elem-independent");
    const r = await decide(extractionId, [
      { field_name: "controls", element_key: "CC6.1", decision: "accept" },
      { field_name: "controls", element_key: "A1.2", decision: "reject", reviewer_note: "not our service" },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows = await pool.query<{ element_key: string; decision: string }>(
      `SELECT element_key, decision FROM vendor_assurance_review_decisions
        WHERE extraction_id=$1 AND element_key IS NOT NULL ORDER BY element_key`, [extractionId]
    );
    expect(rows.rows).toEqual([
      { element_key: "A1.2", decision: "reject" },
      { element_key: "CC6.1", decision: "accept" },
    ]);
  });

  it("the model is still APPEND-ONLY — the latest decision per element wins", async () => {
    const { extractionId } = await docWithExtraction("elem-append");
    await decide(extractionId, [{ field_name: "controls", element_key: "CC6.1", decision: "reject" }]);
    await decide(extractionId, [{ field_name: "controls", element_key: "CC6.1", decision: "accept" }]);
    const all = await pool.query(
      `SELECT 1 FROM vendor_assurance_review_decisions WHERE extraction_id=$1 AND element_key='CC6.1'`, [extractionId]);
    expect(all.rowCount).toBe(2);   // both rows kept
    const current = await pool.query<{ decision: string }>(
      `SELECT DISTINCT ON (field_name, element_key) decision
         FROM vendor_assurance_review_decisions
        WHERE extraction_id=$1 AND element_key='CC6.1'
        ORDER BY field_name, element_key, decided_at DESC, id DESC`, [extractionId]);
    expect(current.rows[0]!.decision).toBe("accept");
  });

  it("reviewing a control the extraction does not contain is refused", async () => {
    const { extractionId } = await docWithExtraction("elem-ghost");
    const r = await decide(extractionId, [{ field_name: "controls", element_key: "ZZ9.9", decision: "accept" }]);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("tested_control_not_in_extraction");
    expect(r.body.available).toEqual(["CC6.1", "A1.2"]);
  });

  it("element review is SCOPED to controls — refused on any other field", async () => {
    const { extractionId } = await docWithExtraction("elem-scope");
    const r = await decide(extractionId, [{ field_name: "exceptions", element_key: "A1.2", decision: "accept" }]);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe("element_key_not_supported_for_field");
  });

  it("whole-field decisions still work exactly as before", async () => {
    const { extractionId } = await docWithExtraction("elem-legacy");
    const r = await decide(extractionId, [{ field_name: "vendor_name", decision: "accept" }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (await pool.query<{ element_key: string | null; element_snapshot: unknown }>(
      `SELECT element_key, element_snapshot FROM vendor_assurance_review_decisions
        WHERE extraction_id=$1 AND field_name='vendor_name'`, [extractionId])).rows[0]!;
    expect(row.element_key).toBeNull();
    expect(row.element_snapshot).toBeNull();
  });
});

describe("S4-4C-0 · the database constraints", () => {
  it("an element key on a non-controls field is refused by the database", async () => {
    const { extractionId } = await docWithExtraction("db-scope");
    let code: string | undefined;
    try {
      await pool.query(
        `INSERT INTO vendor_assurance_review_decisions
           (organization_id, extraction_id, field_name, decision, element_key, element_snapshot)
         VALUES ($1,$2,'exceptions','accept','A1.2','{}'::jsonb)`, [seed.orgA.id, extractionId]);
    } catch (e) { code = (e as { code?: string }).code; }
    expect(code).toBe("23514");
  });

  it("an element decision with no snapshot is refused by the database", async () => {
    const { extractionId } = await docWithExtraction("db-snapshot");
    let code: string | undefined;
    try {
      await pool.query(
        `INSERT INTO vendor_assurance_review_decisions
           (organization_id, extraction_id, field_name, decision, element_key)
         VALUES ($1,$2,'controls','accept','CC6.1')`, [seed.orgA.id, extractionId]);
    } catch (e) { code = (e as { code?: string }).code; }
    expect(code).toBe("23514");
  });

  it("a whole-field decision with a stray snapshot is refused", async () => {
    const { extractionId } = await docWithExtraction("db-stray");
    let code: string | undefined;
    try {
      await pool.query(
        `INSERT INTO vendor_assurance_review_decisions
           (organization_id, extraction_id, field_name, decision, element_snapshot)
         VALUES ($1,$2,'controls','accept','{}'::jsonb)`, [seed.orgA.id, extractionId]);
    } catch (e) { code = (e as { code?: string }).code; }
    expect(code).toBe("23514");
  });
});
