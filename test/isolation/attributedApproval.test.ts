/**
 * attributedApproval.test.ts — issue #947, against real Postgres.
 *
 * The rule:
 *
 *   A GOVERNANCE-RELEVANT HUMAN APPROVAL MUST HAVE AN ATTRIBUTED HUMAN ACTOR.
 *
 * Enforced at two layers, and both are exercised here.
 *
 *   APPLICATION — `transitionExtractedDocument` refuses an unattributed caller
 *   with 403 before any query, and writes the VERIFIED approver rather than
 *   `req.userId ?? null`. `req.userId` is populated on exactly one code path,
 *   the JWT-bridge branch of requireApiKey.ts, so a raw API key cannot approve.
 *
 *   DATABASE — a trigger makes a NEW unattributed `approved` state impossible,
 *   so a direct SQL write is refused too.
 *
 * ── Why the database half is a TRIGGER and not a CHECK ──────────────────────
 *
 * `approved_by_user_id` carries `ON DELETE SET NULL` (20260612). A steady-state
 * CHECK is re-evaluated on every update of the row — including the update the
 * FK performs when a referenced user is deleted — so it would make deleting a
 * user who had approved a document FAIL. That turns a data-protection operation
 * into an error: worse than the defect, and a repeat of a mistake this
 * repository has already made once (WORM/FK cascade blocking tenant erasure).
 *
 * The trigger fires only on the TRANSITION into `approved`. The last test in
 * this file is the one that proves the choice: a user who approved a document
 * can still be deleted, and the historical row survives with a NULL approver.
 * If someone later "simplifies" the trigger into a CHECK, that test fails.
 */

// Set BEFORE the jwt module is imported — signJwt reads JWT_SECRET at call
// time, but the app under test resolves it during module init.
process.env["JWT_SECRET"] ??= "test-jwt-secret-for-attributed-approval";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { ASSURANCE_BEARING_FIELD_NAMES } from "../../src/api/lib/vendorAssuranceValidation.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let userA = "";
let userB = "";
let jwtA = "";
let jwtB = "";
let vendorA = "";
let vendorB = "";

/**
 * An `extracted` document with an extraction — the only approvable state.
 *
 * S4-4C-0 added a review-authority gate in front of approval, so a document is
 * only approvable once its assurance-bearing fields and every tested control
 * carry a current review decision. These tests are about ATTRIBUTION (#947),
 * not about review, so `reviewed` defaults to satisfying that gate. The tests
 * that assert a REFUSAL do not depend on it — the human-approver check and the
 * tenant check both run before the gate.
 */
async function extractedDoc(
  orgId: string,
  vendorId: string,
  label: string,
  opts: { reviewed?: boolean } = {}
): Promise<string> {
  const d = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256,
        storage_key, mime_type, processing_status)
     VALUES ($1, $2, $3, 1024, $4, $5, 'application/pdf', 'extracted')
     RETURNING id`,
    [orgId, vendorId, `${label}.pdf`, label.padEnd(64, "0").slice(0, 64), `k/${label}.pdf`]
  );
  const documentId = d.rows[0]!.id;

  const controls = [{ control_id: "CC6.1", result: "No exception noted." }];
  const fields: Record<string, unknown> = { controls: { value: controls, confidence: 0.99, status: "extracted" } };
  for (const f of ASSURANCE_BEARING_FIELD_NAMES) {
    if (f !== "controls") fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }
  const e = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_extractions (organization_id, document_id, model_id, prompt_version, fields)
     VALUES ($1,$2,'test-model','v1',$3::jsonb) RETURNING id`,
    [orgId, documentId, JSON.stringify(fields)]
  );
  const extractionId = e.rows[0]!.id;

  if (opts.reviewed !== false) {
    for (const field of ASSURANCE_BEARING_FIELD_NAMES) {
      await pool.query(
        `INSERT INTO vendor_assurance_review_decisions
           (organization_id, extraction_id, field_name, decision, decided_by_user_id)
         VALUES ($1,$2,$3,'accept',$4)`,
        [orgId, extractionId, field, orgId === seed.orgA.id ? userA : userB]
      );
    }
    await pool.query(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id,
          element_key, element_snapshot)
       VALUES ($1,$2,'controls','accept',$3,'CC6.1',$4::jsonb)`,
      [orgId, extractionId, orgId === seed.orgA.id ? userA : userB, JSON.stringify(controls[0])]
    );
  }
  return documentId;
}

const docRow = async (id: string) =>
  (await pool.query<{ processing_status: string; approved_at: string | null; approved_by_user_id: string | null }>(
    `SELECT processing_status, approved_at::text AS approved_at, approved_by_user_id
       FROM vendor_assurance_documents WHERE id = $1`, [id]
  )).rows[0]!;

const approvalAudit = async (id: string) =>
  (await pool.query<{ actor_user_id: string | null }>(
    `SELECT actor_user_id FROM security_audit_log
      WHERE resource_id = $1 AND event_type = 'vendor_assurance.document.approved'
      ORDER BY created_at`, [id]
  )).rows;

const approvalAuditCount = async (id: string) => (await approvalAudit(id)).length;

/**
 * Audit writes are FIRE-AND-FORGET — `writeAuditEvent` is not awaited, and on
 * the issue path it is deferred to after commit. Asserting the count the
 * instant a response lands is therefore a race: it passes file-by-file and
 * fails intermittently under full-suite load, which is exactly the flake class
 * this package exists to remove. Wait for the expected count instead.
 *
 * For an expected count of 0 there is nothing to wait FOR, so settle briefly
 * and then read — enough for a stray write to have landed if one were coming.
 */
async function awaitAuditCount(id: string, expected: number): Promise<number> {
  if (expected === 0) {
    await new Promise((r) => setTimeout(r, 300));
    return approvalAuditCount(id);
  }
  let n = 0;
  for (let i = 0; i < 120; i += 1) {
    n = await approvalAuditCount(id);
    if (n >= expected) return n;
    await new Promise((r) => setTimeout(r, 25));
  }
  return n;
}

async function sqlstate(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (e) { return (e as { code?: string }).code; }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const uA = await seedUser(pool, seed.orgA.id, { email: "approver-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "approver-b@example.com" });
  userA = uA.id;
  userB = uB.id;
  // A session-token request passes through requireConsent, so a user with no
  // recorded consent is refused before the handler runs.
  for (const [u, org] of [[uA, seed.orgA.id], [uB, seed.orgB.id]] as const) {
    await recordAllCurrentConsents(pool, {
      userId: u.id,
      organizationId: org,
      consentMethod: "admin_recorded",
    });
  }
  jwtA = signJwt(userA, seed.orgA.id, "admin");
  jwtB = signJwt(userB, seed.orgB.id, "admin");
  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Approval vendor A" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "Approval vendor B" });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 300_000);

afterAll(async () => { await pool?.end(); });

describe("#947 · the application layer", () => {
  it("a real authenticated human approval succeeds and is attributed", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "app-happy");
    const r = await request(app)
      .post(`/api/vendor-assurance/documents/${id}/approve`)
      .set("Authorization", `Bearer ${jwtA}`)
      .send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const row = await docRow(id);
    expect(row.processing_status).toBe("approved");
    expect(row.approved_at).not.toBeNull();
    expect(row.approved_by_user_id).toBe(userA);
  });

  it("the audit actor is the SAME human the row is attributed to", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "app-audit");
    const r = await request(app)
      .post(`/api/vendor-assurance/documents/${id}/approve`)
      .set("Authorization", `Bearer ${jwtA}`)
      .send({});
    expect(r.status).toBe(200);

    expect(await awaitAuditCount(id, 1)).toBe(1);
    const audits = await approvalAudit(id);
    // The trail and the record cannot name different people — or nobody.
    expect(audits[0]!.actor_user_id).toBe((await docRow(id)).approved_by_user_id);
    expect(audits[0]!.actor_user_id).toBe(userA);
  });

  it("an API-KEY-ONLY caller cannot approve — 403, before any write", async () => {
    // The guard stack does not require a user session, so this request is
    // otherwise perfectly authorized. It is refused because it names nobody.
    const id = await extractedDoc(seed.orgA.id, vendorA, "app-apikey");
    const r = await request(app)
      .post(`/api/vendor-assurance/documents/${id}/approve`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe("human_approver_required");

    const row = await docRow(id);
    expect(row.processing_status).toBe("extracted");
    expect(row.approved_by_user_id).toBeNull();
    expect(row.approved_at).toBeNull();
    expect(await awaitAuditCount(id, 0)).toBe(0);
  });

  it("an unauthenticated caller cannot approve", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "app-anon");
    const r = await request(app).post(`/api/vendor-assurance/documents/${id}/approve`).send({});
    expect([401, 403]).toContain(r.status);
    expect((await docRow(id)).processing_status).toBe("extracted");
  });

  it("a human from another org cannot approve — 404, and writes nothing", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "app-xtenant");
    const r = await request(app)
      .post(`/api/vendor-assurance/documents/${id}/approve`)
      .set("Authorization", `Bearer ${jwtB}`)
      .send({});
    expect(r.status, JSON.stringify(r.body)).toBe(404);

    const row = await docRow(id);
    expect(row.processing_status).toBe("extracted");
    expect(row.approved_by_user_id).toBeNull();
    expect(await awaitAuditCount(id, 0)).toBe(0);
  });

  it("re-approval is refused: exactly one approval, one approver, one audit event", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "app-repeat");
    const first = await request(app)
      .post(`/api/vendor-assurance/documents/${id}/approve`)
      .set("Authorization", `Bearer ${jwtA}`).send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/vendor-assurance/documents/${id}/approve`)
      .set("Authorization", `Bearer ${jwtA}`).send({});
    // The UPDATE re-asserts processing_status = 'extracted', so the second
    // request loses and says so.
    expect(second.status, JSON.stringify(second.body)).toBe(409);

    expect((await docRow(id)).approved_by_user_id).toBe(userA);
    expect(await awaitAuditCount(id, 1)).toBe(1);
  });

  it("two concurrent approvals produce exactly ONE approval and ONE audit event", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "app-concurrent");
    const [a, b] = await Promise.all([
      request(app).post(`/api/vendor-assurance/documents/${id}/approve`)
        .set("Authorization", `Bearer ${jwtA}`).send({}),
      request(app).post(`/api/vendor-assurance/documents/${id}/approve`)
        .set("Authorization", `Bearer ${jwtA}`).send({}),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y), `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`)
      .toEqual([200, 409]);
    expect((await docRow(id)).approved_by_user_id).toBe(userA);
    expect(await awaitAuditCount(id, 1)).toBe(1);
  });

  it("reject and request-manual-review are UNCHANGED — they record no approver", async () => {
    // Scope check: #947 is about approvals. The other two review actions do not
    // attribute an approver and must keep working for an API-key caller.
    const rejected = await extractedDoc(seed.orgA.id, vendorA, "app-reject");
    const r1 = await request(app)
      .post(`/api/vendor-assurance/documents/${rejected}/reject`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ reason: "illegible scan" });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect((await docRow(rejected)).processing_status).toBe("rejected");

    const review = await extractedDoc(seed.orgA.id, vendorA, "app-review");
    const r2 = await request(app)
      .post(`/api/vendor-assurance/documents/${review}/request-manual-review`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ comment: "second pair of eyes" });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect((await docRow(review)).processing_status).toBe("manual_review_requested");
  });
});

describe("#947 · the database layer", () => {
  it("a NEW approved state with a NULL approver is refused by the database", async () => {
    // Bypasses the route entirely. The application guard is not the only thing
    // standing between an integration and an unattributed version of record.
    const id = await extractedDoc(seed.orgA.id, vendorA, "db-null-approver");
    const code = await sqlstate(pool.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'approved', approved_at = NOW(), approved_by_user_id = NULL
        WHERE id = $1`, [id]
    ));
    expect(code).toBe("23514");
    expect((await docRow(id)).processing_status).toBe("extracted");
  });

  it("a NEW approved state with no approved_at is refused by the database", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "db-null-at");
    const code = await sqlstate(pool.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'approved', approved_at = NULL, approved_by_user_id = $2
        WHERE id = $1`, [id, userA]
    ));
    // Either constraint may catch this first — the approved-consistency CHECK
    // from 20260612 or the #947 trigger. Both are check violations, and either
    // is a correct refusal.
    expect(code).toBe("23514");
    expect((await docRow(id)).processing_status).toBe("extracted");
  });

  it("a fully attributed approval is permitted by the database", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "db-ok");
    expect(await sqlstate(pool.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'approved', approved_at = NOW(), approved_by_user_id = $2
        WHERE id = $1`, [id, userA]
    ))).toBeUndefined();
    expect((await docRow(id)).approved_by_user_id).toBe(userA);
  });

  it("an INSERT that lands directly in approved with no approver is refused", async () => {
    const code = await sqlstate(pool.query(
      `INSERT INTO vendor_assurance_documents
         (organization_id, vendor_id, original_filename, byte_size, sha256,
          storage_key, mime_type, processing_status, approved_at)
       VALUES ($1, $2, 'direct.pdf', 1024, repeat('d', 64), 'k/direct.pdf',
               'application/pdf', 'approved', NOW())`,
      [seed.orgA.id, vendorA]
    ));
    expect(code).toBe("23514");
  });
});

describe("#947 · historical rows and user deletion are handled deliberately", () => {
  it("an ALREADY-approved row can still be updated — the trigger guards the TRANSITION, not the state", async () => {
    const id = await extractedDoc(seed.orgA.id, vendorA, "hist-update");
    await pool.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'approved', approved_at = NOW(), approved_by_user_id = $2
        WHERE id = $1`, [id, userA]
    );
    // An unrelated update to an approved row must not be blocked.
    expect(await sqlstate(pool.query(
      `UPDATE vendor_assurance_documents SET updated_at = NOW() WHERE id = $1`, [id]
    ))).toBeUndefined();
    expect((await docRow(id)).processing_status).toBe("approved");
  });

  it("DELETING THE APPROVER STILL WORKS, and the historical row survives with a NULL approver", async () => {
    // THIS is the test that justifies a trigger over a CHECK. approved_by_user_id
    // carries ON DELETE SET NULL, so deleting the approver updates this row to
    // approver = NULL. A steady-state CHECK would re-evaluate and make the user
    // DELETE fail — breaking erasure to protect an invariant. The trigger does
    // not fire, because this is not a transition into `approved`.
    //
    // If this test ever fails, someone replaced the trigger with a CHECK.
    const doomed = await seedUser(pool, seed.orgA.id, { email: "doomed-approver@example.com" });
    const id = await extractedDoc(seed.orgA.id, vendorA, "hist-delete");
    await pool.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'approved', approved_at = NOW(), approved_by_user_id = $2
        WHERE id = $1`, [id, doomed.id]
    );
    expect((await docRow(id)).approved_by_user_id).toBe(doomed.id);

    expect(await sqlstate(pool.query(`DELETE FROM users WHERE id = $1`, [doomed.id]))).toBeUndefined();

    const row = await docRow(id);
    expect(row.processing_status).toBe("approved");   // history preserved
    expect(row.approved_at).not.toBeNull();
    expect(row.approved_by_user_id).toBeNull();       // attribution lost with the user, by design
  });

  it("the trigger exists and is bound to the documents table", async () => {
    const r = await pool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'vendor_assurance_documents'::regclass
          AND tgname = 'trg_vendor_assurance_require_attributed_approval'`
    );
    expect(r.rowCount).toBe(1);
  });
});
