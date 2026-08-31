/**
 * assuranceOutcomeAuthority.test.ts — VA-S4-4C-3 against a real Postgres.
 *
 * The pure core is unit-tested in src/api/__tests__/testedControlOutcome.test.ts.
 * What can only be proven here is the AUTHORITY: who may write a governed
 * determination, what the database refuses regardless of the route, and what
 * remains true when someone tries to make one layer overwrite another.
 *
 * Every proof the owner's section 8 requires has a test in this file, named for
 * it. They are the point of the package; the happy path is not.
 */

process.env["JWT_SECRET"] ??= "test-jwt-secret-for-assurance-outcome-authority";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { ASSURANCE_BEARING_FIELD_NAMES } from "../../src/api/lib/vendorAssuranceValidation.js";
import { publishCanonicalControls } from "../../src/api/lib/controls/canonicalControlPublisher.js";
import { materializeTestedControlOutcomes } from "../../src/api/lib/vendorAssurance/outcomeMaterializer.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let userA = "", userB = "", viewerA = "", jwtA = "", jwtB = "", jwtViewerA = "";
let vendorA = "", vendorB = "";
let apiKeyA = "";

const ctrl = (id: string, result: string) => ({
  control_id: id,
  description: `Tested control ${id}`,
  test_procedure: "Inspected configuration and reperformed for a sample of 25.",
  result,
});

/** An `extracted`, fully-reviewed, approvable SOC 2 document. */
async function extractedDoc(
  orgId: string,
  vendorId: string,
  label: string,
  opts: { controls?: ReturnType<typeof ctrl>[]; exceptions?: unknown[]; responses?: unknown[] } = {}
): Promise<{ documentId: string; extractionId: string }> {
  const controls = opts.controls ?? [ctrl("CC6.1", "No exceptions noted.")];
  const d = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256,
        storage_key, mime_type, document_type_hint, processing_status)
     VALUES ($1,$2,$3,1024,$4,$5,'application/pdf','soc2_type2','extracted') RETURNING id`,
    [orgId, vendorId, `${label}.pdf`, label.padEnd(64, "0").slice(0, 64), `k/${label}.pdf`]
  );
  const documentId = d.rows[0]!.id;

  const fields: Record<string, unknown> = {
    controls: { value: controls, confidence: 0.99, status: "extracted" },
    exceptions: { value: opts.exceptions ?? [], confidence: 0.9, status: "extracted" },
    management_responses: { value: opts.responses ?? [], confidence: 0.9, status: "extracted" },
  };
  for (const f of ASSURANCE_BEARING_FIELD_NAMES) {
    if (!(f in fields)) fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }
  const e = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_extractions (organization_id, document_id, model_id, prompt_version, fields)
     VALUES ($1,$2,'test-model','soc-extraction-v3',$3::jsonb) RETURNING id`,
    [orgId, documentId, JSON.stringify(fields)]
  );
  const extractionId = e.rows[0]!.id;
  const uid = orgId === seed.orgA.id ? userA : userB;

  for (const field of ASSURANCE_BEARING_FIELD_NAMES) {
    await pool.query(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id)
       VALUES ($1,$2,$3,'accept',$4)`,
      [orgId, extractionId, field, uid]
    );
  }
  for (const c of controls) {
    await pool.query(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id,
          element_key, element_snapshot)
       VALUES ($1,$2,'controls','accept',$3,$4,$5::jsonb)`,
      [orgId, extractionId, uid, c.control_id, JSON.stringify(c)]
    );
  }
  return { documentId, extractionId };
}

const approve = (id: string, jwt: string) =>
  request(app).post(`/api/vendor-assurance/documents/${id}/approve`).set("Authorization", `Bearer ${jwt}`).send({});

const outcomes = (id: string, jwt: string) =>
  request(app).get(`/api/vendor-assurance/documents/${id}/assurance-outcomes`).set("Authorization", `Bearer ${jwt}`);

const decideEffectiveness = (docId: string, key: string, jwt: string | null, body: unknown) => {
  const r = request(app).post(
    `/api/vendor-assurance/documents/${docId}/tested-controls/${encodeURIComponent(key)}/effectiveness`
  );
  return (jwt ? r.set("Authorization", `Bearer ${jwt}`) : r.set("x-api-key", apiKeyA)).send(body);
};

const decideExceptionEffect = (exceptionId: string, jwt: string | null, body: unknown) => {
  const r = request(app).post(`/api/vendor-assurance/exceptions/${exceptionId}/effect`);
  return (jwt ? r.set("Authorization", `Bearer ${jwt}`) : r.set("x-api-key", apiKeyA)).send(body);
};

/** Materialization is fire-and-forget after the approve response; wait for it. */
async function awaitAssertions(extractionId: string, expected: number) {
  for (let i = 0; i < 200; i += 1) {
    const r = await pool.query(
      `SELECT element_key FROM vendor_tested_control_assertions
        WHERE extraction_id = $1 AND superseded_at IS NULL`,
      [extractionId]
    );
    if (r.rows.length >= expected) return r.rows;
    await new Promise((res) => setTimeout(res, 25));
  }
  return (
    await pool.query(
      `SELECT element_key FROM vendor_tested_control_assertions
        WHERE extraction_id = $1 AND superseded_at IS NULL`,
      [extractionId]
    )
  ).rows;
}

const liveExceptions = async (extractionId: string) =>
  (
    await pool.query(
      `SELECT id, exception_ref, source_ordinal, governed_effect, source_term
         FROM vendor_assurance_exceptions
        WHERE extraction_id = $1 AND superseded_at IS NULL
        ORDER BY source_ordinal`,
      [extractionId]
    )
  ).rows;

const linksOf = async (exceptionId: string) =>
  (
    await pool.query(
      `SELECT element_key, link_source, source_value
         FROM vendor_assurance_exception_controls
        WHERE exception_id = $1 ORDER BY element_key`,
      [exceptionId]
    )
  ).rows;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
  // The capability gate is a passthrough while the seat model is off, so the
  // authorization tests below would pass VACUOUSLY without this. Staging and
  // production both run it `true`.
  process.env["SECURELOGIC_SEAT_MODEL_ENABLED"] = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const uA = await seedUser(pool, seed.orgA.id, { email: "outcome-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "outcome-b@example.com" });
  const vA = await seedUser(pool, seed.orgA.id, { email: "outcome-viewer-a@example.com" });
  userA = uA.id; userB = uB.id; viewerA = vA.id;
  for (const [u, org] of [[uA, seed.orgA.id], [uB, seed.orgB.id], [vA, seed.orgA.id]] as const) {
    await recordAllCurrentConsents(pool, { userId: u.id, organizationId: org, consentMethod: "admin_recorded" });
  }
  await pool.query(`UPDATE users SET seat_type = 'viewer', role = 'viewer' WHERE id = $1`, [viewerA]);

  jwtA = signJwt(userA, seed.orgA.id, "admin");
  jwtB = signJwt(userB, seed.orgB.id, "admin");
  jwtViewerA = signJwt(viewerA, seed.orgA.id, "viewer");

  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Outcome vendor A" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "Outcome vendor B" });

  await publishCanonicalControls(pool as never, { publishedByUserId: userA, apply: true });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // The "generic API key alone" adversary: org A's own premium API key, seeded
  // by the harness. It authenticates, it carries the premium entitlement, and
  // scopeForApiKey() resolves it to a full/admin seat — so it holds every
  // capability a tenant-write identity holds, including assurance:review.
  apiKeyA = seed.orgA.apiKey;
}, 300_000);

afterAll(async () => { await pool?.end(); });

/* ═══════════════════════════════════════════════════════════════════════
   LAYER 1 lands, and asserts only what it claims to.
   ═══════════════════════════════════════════════════════════════════════ */

describe("LAYER 1 — the auditor assertion is materialised at approval", () => {
  it("every tested control gets one assertion, with the verbatim result and its provenance", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "l1-happy", {
      controls: [
        ctrl("CC6.1", "No exceptions noted."),
        ctrl("CC6.2", "Deviation noted: the Q3 review was completed 19 days after the documented due date."),
        ctrl("CC7.2", "Not tested. The category was not within the scope of this examination."),
      ],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitAssertions(extractionId, 3);

    const rows = (await pool.query(
      `SELECT element_key, auditor_assertion, source_text, source_term, effective_source,
              normalizer_version, normalizer_rule, normalizer_reason
         FROM vendor_tested_control_assertions
        WHERE extraction_id = $1 AND superseded_at IS NULL ORDER BY element_key`,
      [extractionId]
    )).rows;

    expect(rows.map((r) => [r.element_key, r.auditor_assertion])).toEqual([
      ["CC6.1", "NO_EXCEPTION_NOTED"],
      ["CC6.2", "DEVIATION_NOTED"],
      ["CC7.2", "NOT_TESTED"],
    ]);
    // The auditor's own words, kept beside the normalized value.
    expect(rows[1]!.source_text).toMatch(/19 days after the documented due date/);
    expect(rows[1]!.source_term).toBe("deviation");
    expect(rows[0]!.source_term).toBeNull();
    for (const r of rows) {
      expect(r.effective_source).toBe("extraction");
      expect(r.normalizer_version).toBe("tested-control-assertion-1.0");
      expect(String(r.normalizer_reason).length).toBeGreaterThan(0);
    }
  });

  it("LAYER 1 CARRIES NO HUMAN AUTHORITY — the table has no actor column at all", async () => {
    const cols = (await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'vendor_tested_control_assertions'`
    )).rows.map((r) => r.column_name);
    // The absence is the design: a reviewer who disagrees says so in Layer 2.
    expect(cols.filter((c: string) => c.includes("user_id"))).toEqual([]);
  });

  it("an unreadable result becomes NOT_STATED in the database, never a clean assertion", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "l1-unreadable", {
      controls: [ctrl("CC6.1", "Refer to Section IV.")],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitAssertions(extractionId, 1);
    const r = (await pool.query(
      `SELECT auditor_assertion FROM vendor_tested_control_assertions
        WHERE extraction_id=$1 AND superseded_at IS NULL`,
      [extractionId]
    )).rows[0]!;
    expect(r.auditor_assertion).toBe("NOT_STATED");
  });

  it("the database refuses an assertion outside the vocabulary", async () => {
    const { extractionId, documentId } = await extractedDoc(seed.orgA.id, vendorA, "l1-vocab");
    await expect(
      pool.query(
        `INSERT INTO vendor_tested_control_assertions
           (organization_id, document_id, extraction_id, element_key, auditor_assertion,
            source_text, effective_source, normalizer_version, normalizer_rule, normalizer_reason)
         VALUES ($1,$2,$3,'CC6.1','PROBABLY_FINE','x','extraction','v','r','r')`,
        [seed.orgA.id, documentId, extractionId]
      )
    ).rejects.toThrow(/vocabulary_check/);
  });

  it("only NOT_STATED may have no source text — every other value must have read something", async () => {
    const { extractionId, documentId } = await extractedDoc(seed.orgA.id, vendorA, "l1-src");
    await expect(
      pool.query(
        `INSERT INTO vendor_tested_control_assertions
           (organization_id, document_id, extraction_id, element_key, auditor_assertion,
            source_text, effective_source, normalizer_version, normalizer_rule, normalizer_reason)
         VALUES ($1,$2,$3,'CC6.1','NO_EXCEPTION_NOTED',NULL,'extraction','v','r','r')`,
        [seed.orgA.id, documentId, extractionId]
      )
    ).rejects.toThrow(/source_text_check/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUIRED PROOF: unauthorized humans and generic API keys.
   ═══════════════════════════════════════════════════════════════════════ */

describe("REQUIRED — a generic API key alone cannot establish human effectiveness authority", () => {
  let documentId = "", extractionId = "";
  beforeAll(async () => {
    const d = await extractedDoc(seed.orgA.id, vendorA, "auth-apikey", {
      controls: [ctrl("CC6.1", "No exceptions noted.")],
    });
    documentId = d.documentId; extractionId = d.extractionId;
    await approve(documentId, jwtA);
    await awaitAssertions(extractionId, 1);
  }, 60_000);

  it("the API key PASSES the capability gate — and is still refused, at the human gate", async () => {
    const r = await decideEffectiveness(documentId, "CC6.1", null, {
      effectiveness: "EFFECTIVE",
      reviewer_note: "a machine trying to assert effectiveness",
    });
    // Not 403 capability_required: the key legitimately holds assurance:review
    // via scopeForApiKey(). The refusal is on the ORTHOGONAL human axis.
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("human_reviewer_required");
    expect(r.body.error).not.toBe("capability_required");
  });

  it("nothing was written", async () => {
    const n = (await pool.query(
      `SELECT count(*)::int AS n FROM vendor_tested_control_effectiveness WHERE extraction_id=$1`,
      [extractionId]
    )).rows[0]!.n;
    expect(n).toBe(0);
  });

  it("the DATABASE refuses an unattributed acceptance too — the route is not the boundary", async () => {
    await expect(
      pool.query(
        `INSERT INTO vendor_tested_control_effectiveness
           (organization_id, document_id, extraction_id, element_key, decision,
            governed_effectiveness, accepted_by_user_id)
         VALUES ($1,$2,$3,'CC6.1','accepted','EFFECTIVE',NULL)`,
        [seed.orgA.id, documentId, extractionId]
      )
    ).rejects.toThrow(/no attributed human reviewer/);
  });

  it("a VIEWER seat holds no assurance:review capability and is refused", async () => {
    const r = await decideEffectiveness(documentId, "CC6.1", jwtViewerA, {
      effectiveness: "INDETERMINATE",
      indeterminate_reason: "not_tested",
    });
    expect(r.status).toBe(403);
    // The viewer is refused by the GLOBAL MUTATION CHOKEPOINT, which sits ahead
    // of the capability gate and returns `read_only_access`. Asserted as the
    // actual error rather than the one this package added, because the point is
    // that a read-only seat cannot reach the write AT ALL — and it is a stronger
    // guarantee that it never gets as far as needing the capability.
    expect(["read_only_access", "capability_required", "seat_not_permitted"]).toContain(r.body.error);
  });

  it("a viewer holds no assurance:review capability in the resolved scope either", async () => {
    const { resolveScope } = await import("../../src/api/lib/seatScope.js");
    expect(resolveScope("viewer", "viewer").capabilities.has("assurance:review")).toBe(false);
    expect(resolveScope("contributor", "analyst").capabilities.has("assurance:review")).toBe(false);
    expect(resolveScope("full", "analyst").capabilities.has("assurance:review")).toBe(true);
    // And the API key's resolved scope DOES hold it — which is exactly why the
    // capability cannot be the human gate.
    const { scopeForApiKey } = await import("../../src/api/lib/seatScope.js");
    expect(scopeForApiKey().capabilities.has("assurance:review")).toBe(true);
  });

  it("an AUTHORIZED reviewer can accept, edit and reject", async () => {
    const accept = await decideEffectiveness(documentId, "CC6.1", jwtA, {
      effectiveness: "EFFECTIVE",
      reviewer_note: "Period and TSC scope both cover our use; no contradictory evidence on file.",
    });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body.decided.governed_effectiveness).toBe("EFFECTIVE");
    expect(accept.body.decided.accepted_by_user_id).toBe(userA);

    // EDIT — supersession, never mutation.
    const edit = await decideEffectiveness(documentId, "CC6.1", jwtA, {
      effectiveness: "INDETERMINATE",
      indeterminate_reason: "scope_limited",
      supersede: true,
      reviewer_note: "On re-read the report period stops before our contract began.",
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);

    // REJECT — withdraws the governed answer and asserts none.
    const reject = await decideEffectiveness(documentId, "CC6.1", jwtA, {
      decision: "rejected",
      supersede: true,
      reviewer_note: "Withdrawn pending the successor report.",
    });
    expect(reject.status, JSON.stringify(reject.body)).toBe(200);
    expect(reject.body.decided.governed_effectiveness).toBeNull();

    const rows = (await pool.query(
      `SELECT decision, governed_effectiveness, superseded_at FROM vendor_tested_control_effectiveness
        WHERE extraction_id=$1 ORDER BY accepted_at`,
      [extractionId]
    )).rows;
    expect(rows).toHaveLength(3);
    // History intact, exactly one live row.
    expect(rows.filter((r) => r.superseded_at === null)).toHaveLength(1);
    expect(rows[0]!.governed_effectiveness).toBe("EFFECTIVE");
  });

  it("REQUIRED — actor, timestamp and basis are historically preserved, never rewritten", async () => {
    const rows = (await pool.query(
      `SELECT accepted_by_user_id, accepted_at, basis FROM vendor_tested_control_effectiveness
        WHERE extraction_id=$1 AND superseded_at IS NOT NULL ORDER BY accepted_at`,
      [extractionId]
    )).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.accepted_by_user_id).toBe(userA);
      expect(r.accepted_at).not.toBeNull();
      // The basis snapshot survives the supersession that replaced its row.
      expect(r.basis.layer1.auditor_assertion).toBe("NO_EXCEPTION_NOTED");
      expect(r.basis.establishes_requirement_coverage).toBe(false);
    }
  });

  it("the three authority actions are DISTINCT audit events — one never performs another", async () => {
    const types = (await pool.query(
      `SELECT DISTINCT event_type FROM security_audit_log
        WHERE organization_id=$1 AND resource_id=$2 AND event_type LIKE 'vendor_assurance.%'`,
      [seed.orgA.id, documentId]
    )).rows.map((r) => r.event_type).sort();
    expect(types).toContain("vendor_assurance.control_effectiveness.decided");
    expect(types).toContain("vendor_assurance.control_effectiveness.superseded");
    // Approving the document is its own event and is not re-emitted by a
    // Layer-2 decision.
    expect(types.filter((t: string) => t.includes("effectiveness")).length).toBeGreaterThan(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUIRED PROOF: fail-closed.
   ═══════════════════════════════════════════════════════════════════════ */

describe("REQUIRED — an unknown outcome cannot become EFFECTIVE by default", () => {
  let documentId = "", extractionId = "";
  beforeAll(async () => {
    const d = await extractedDoc(seed.orgA.id, vendorA, "failclosed", {
      controls: [ctrl("CC6.2", "Something the normalizer has never seen.")],
    });
    documentId = d.documentId; extractionId = d.extractionId;
    await approve(documentId, jwtA);
    await awaitAssertions(extractionId, 1);
  }, 60_000);

  it("materialisation writes NO governed effectiveness — Layer 2 is never seeded", async () => {
    const n = (await pool.query(
      `SELECT count(*)::int AS n FROM vendor_tested_control_effectiveness WHERE extraction_id=$1`,
      [extractionId]
    )).rows[0]!.n;
    expect(n).toBe(0);
  });

  it("the read surface reports the control as UNRESOLVED, not as effective", async () => {
    const r = await outcomes(documentId, jwtA);
    expect(r.status).toBe(200);
    expect(r.body.unresolved.controls_without_governed_effectiveness).toContain("CC6.2");
    expect(r.body.auditor_assertions[0]!.governed_effectiveness).toBeNull();
    expect(r.body.auditor_assertions[0]!.assertion).toBe("NOT_STATED");
    expect(r.body.auditor_assertions[0]!.establishes_governed_effectiveness).toBe(false);
    expect(r.body.auditor_assertions[0]!.suggested_effectiveness.candidate).toBeNull();
    expect(r.body.auditor_assertions[0]!.suggested_effectiveness.requires_human).toBe(true);
  });

  it("omitting the value is a 400 refusal, not a defaulted EFFECTIVE", async () => {
    const r = await decideEffectiveness(documentId, "CC6.2", jwtA, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("effectiveness_required");
  });

  it("the database has NO DEFAULT that could supply one", async () => {
    const d = (await pool.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name='vendor_tested_control_effectiveness'
          AND column_name='governed_effectiveness'`
    )).rows[0]!;
    expect(d.column_default).toBeNull();
  });

  it("INDETERMINATE with a reason outside the closed set is refused by the database too", async () => {
    await expect(
      pool.query(
        `INSERT INTO vendor_tested_control_effectiveness
           (organization_id, document_id, extraction_id, element_key, decision,
            governed_effectiveness, indeterminate_reason, accepted_by_user_id)
         VALUES ($1,$2,$3,'CC6.2','accepted','INDETERMINATE','other',$4)`,
        [seed.orgA.id, documentId, extractionId, userA]
      )
    ).rejects.toThrow(/reason_vocabulary_check/);
  });

  it("INDETERMINATE with NO reason is refused by the database", async () => {
    await expect(
      pool.query(
        `INSERT INTO vendor_tested_control_effectiveness
           (organization_id, document_id, extraction_id, element_key, decision,
            governed_effectiveness, accepted_by_user_id)
         VALUES ($1,$2,$3,'CC6.2','accepted','INDETERMINATE',$4)`,
        [seed.orgA.id, documentId, extractionId, userA]
      )
    ).rejects.toThrow(/indeterminate_reason_check/);
  });

  it("a rejection carrying an effectiveness is refused by the database", async () => {
    await expect(
      pool.query(
        `INSERT INTO vendor_tested_control_effectiveness
           (organization_id, document_id, extraction_id, element_key, decision,
            governed_effectiveness, accepted_by_user_id, reviewer_note)
         VALUES ($1,$2,$3,'CC6.2','rejected','EFFECTIVE',$4,'why')`,
        [seed.orgA.id, documentId, extractionId, userA]
      )
    ).rejects.toThrow(/shape_check/);
  });

  it("deciding effectiveness for a control the document does not test is refused", async () => {
    const r = await decideEffectiveness(documentId, "PI1.1", jwtA, {
      effectiveness: "EFFECTIVE",
      reviewer_note: "x",
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("tested_control_assertion_not_found");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUIRED PROOF: the layers cannot overwrite one another.
   ═══════════════════════════════════════════════════════════════════════ */

describe("REQUIRED — exception presence cannot be erased by EFFECTIVE status", () => {
  let documentId = "", extractionId = "", exceptionId = "";

  beforeAll(async () => {
    const d = await extractedDoc(seed.orgA.id, vendorA, "orthogonal", {
      controls: [ctrl("CC6.1", "Exception noted: 3 of 25 access requests lacked documented manager approval.")],
      exceptions: [
        {
          exception_ref: "Exception 1",
          control_refs: ["CC6.1"],
          description: "3 of 25 access requests lacked documented manager approval.",
          auditor_assessment: "Exception noted in Section IV.",
        },
      ],
    });
    documentId = d.documentId; extractionId = d.extractionId;
    await approve(documentId, jwtA);
    await awaitAssertions(extractionId, 1);
    for (let i = 0; i < 200 && exceptionId === ""; i += 1) {
      const rows = await liveExceptions(extractionId);
      if (rows.length > 0) exceptionId = rows[0]!.id;
      else await new Promise((r) => setTimeout(r, 25));
    }
  }, 60_000);

  it("the exception is materialised with its own identity and its control link", async () => {
    expect(exceptionId).not.toBe("");
    const rows = await liveExceptions(extractionId);
    expect(rows[0]!.exception_ref).toBe("Exception 1");
    expect(rows[0]!.source_term).toBe("exception");
    expect(rows[0]!.governed_effect).toBeNull();
    const links = await linksOf(exceptionId);
    expect(links).toEqual([
      { element_key: "CC6.1", link_source: "extraction_control_refs", source_value: "CC6.1" },
    ]);
  });

  it("accepting EFFECTIVE leaves the exception STANDING, untouched", async () => {
    const before = await liveExceptions(extractionId);
    const r = await decideEffectiveness(documentId, "CC6.1", jwtA, {
      effectiveness: "EFFECTIVE",
      reviewer_note: "The exception concerns a workflow we do not use; scope reviewed and documented.",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const after = await liveExceptions(extractionId);
    // Byte-identical: EFFECTIVE did not delete, supersede, downgrade or hide it.
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
  });

  it("both facts are reported TOGETHER — no fused value hides either", async () => {
    const r = await outcomes(documentId, jwtA);
    const row = r.body.auditor_assertions.find((a: any) => a.element_key === "CC6.1");
    expect(row.governed_effectiveness).toBe("EFFECTIVE");
    expect(row.has_exception).toBe(true);
    expect(r.body.exceptions).toHaveLength(1);
    // The value that would have hidden one of them does not exist.
    expect(row.governed_effectiveness).not.toBe("EFFECTIVE_WITH_EXCEPTION");
  });

  it("REQUIRED — a report-level clean opinion cannot overwrite control-level exception state", async () => {
    // The document-level opinion is the coarsest signal there is. Set it to the
    // cleanest possible value and prove nothing at the control grain moves.
    const before = {
      exceptions: await liveExceptions(extractionId),
      assertions: (await pool.query(
        `SELECT element_key, auditor_assertion, source_text FROM vendor_tested_control_assertions
          WHERE extraction_id=$1 AND superseded_at IS NULL ORDER BY element_key`,
        [extractionId]
      )).rows,
    };

    await pool.query(
      `UPDATE vendor_assurance_documents
          SET assurance_opinion = 'unmodified',
              assurance_opinion_accepted_by_user_id = $2,
              assurance_opinion_accepted_at = NOW(),
              assurance_opinion_basis = '{"test":"clean report-level opinion"}'::jsonb
        WHERE id = $1`,
      [documentId, userA]
    );

    const after = {
      exceptions: await liveExceptions(extractionId),
      assertions: (await pool.query(
        `SELECT element_key, auditor_assertion, source_text FROM vendor_tested_control_assertions
          WHERE extraction_id=$1 AND superseded_at IS NULL ORDER BY element_key`,
        [extractionId]
      )).rows,
    };

    expect(after).toEqual(before);
    expect(after.assertions[0]!.auditor_assertion).toBe("EXCEPTION_NOTED");

    // And the read surface still reports the exception.
    const r = await outcomes(documentId, jwtA);
    expect(r.body.exceptions).toHaveLength(1);
    expect(r.body.establishes_requirement_coverage).toBe(false);
  });

  it("re-materialising does NOT discard the human's exception interpretation", async () => {
    const eff = await decideExceptionEffect(exceptionId, jwtA, {
      governed_effect: "control_deficiency",
      reviewer_note: "Documented approval genuinely absent for 3 of 25.",
    });
    expect(eff.status, JSON.stringify(eff.body)).toBe(200);

    // Idempotent BY CONTENT: unchanged source, so the row is left alone and the
    // interpretation survives.
    await materializeTestedControlOutcomes(pool as never, {
      organizationId: seed.orgA.id, documentId,
    });
    const rows = await liveExceptions(extractionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(exceptionId);
    expect(rows[0]!.governed_effect).toBe("control_deficiency");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUIRED PROOF: control_ref cannot silently attach to the wrong control.
   ═══════════════════════════════════════════════════════════════════════ */

describe("REQUIRED — control_ref cannot silently attach an exception to the wrong control", () => {
  it("[SYNTHETIC shape] one exception spanning three controls links to all three, and to nothing else", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "multi-link", {
      controls: [
        ctrl("CC6.1", "Exception noted: see Exception 1."),
        ctrl("CC6.2", "Exception noted: see Exception 1."),
        ctrl("CC6.3", "Exception noted: see Exception 1."),
        ctrl("CC7.2", "No exceptions noted."),
      ],
      exceptions: [
        {
          exception_ref: "Exception 1",
          control_refs: ["CC6.1", "CC6.2", "CC6.3"],
          description: "The identity governance platform was unavailable from 3 March to 24 March 2025.",
          auditor_assessment: "Exception noted affecting CC6.1, CC6.2 and CC6.3.",
        },
      ],
      responses: [{ exception_ref: "Exception 1", control_refs: [], response: "Management restored the platform." }],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitAssertions(extractionId, 4);
    let rows = await liveExceptions(extractionId);
    for (let i = 0; i < 200 && rows.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      rows = await liveExceptions(extractionId);
    }
    expect(rows).toHaveLength(1);

    const links = await linksOf(rows[0]!.id);
    expect(links.map((l) => l.element_key)).toEqual(["CC6.1", "CC6.2", "CC6.3"]);
    // CC7.2 was tested and clean; it must not be reached by this exception.
    expect(links.map((l) => l.element_key)).not.toContain("CC7.2");
    // And the LABEL never became a control link.
    expect(links.map((l) => l.element_key)).not.toContain("Exception 1");
  });

  it("[LEGACY shape] the packed scalar links to all three, with the raw string on every link", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "legacy-link", {
      controls: [
        ctrl("CC6.1", "Exception noted: see Exception 1."),
        ctrl("CC6.2", "Exception noted: see Exception 1."),
        ctrl("CC6.3", "Exception noted: see Exception 1."),
      ],
      // Byte-for-byte the v2 corpus row.
      exceptions: [
        {
          control_id: "CC6.1, CC6.2, CC6.3",
          description: "The identity governance platform was unavailable from 3 March to 24 March 2025.",
          auditor_assessment: "Exception noted affecting CC6.1, CC6.2 and CC6.3.",
        },
      ],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitAssertions(extractionId, 3);
    let rows = await liveExceptions(extractionId);
    for (let i = 0; i < 200 && rows.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      rows = await liveExceptions(extractionId);
    }
    const links = await linksOf(rows[0]!.id);
    expect(links.map((l) => l.element_key)).toEqual(["CC6.1", "CC6.2", "CC6.3"]);
    for (const l of links) {
      expect(l.link_source).toBe("legacy_control_id");
      // The provenance that makes the split checkable rather than trusted.
      expect(l.source_value).toBe("CC6.1, CC6.2, CC6.3");
    }
  });

  it("the link-source CHECK has no index_alignment value — the fallback cannot be re-introduced", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "no-index-align", {
      exceptions: [{ exception_ref: "E", control_refs: ["CC6.1"], description: "d" }],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    let rows = await liveExceptions(extractionId);
    for (let i = 0; i < 200 && rows.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      rows = await liveExceptions(extractionId);
    }
    await expect(
      pool.query(
        `INSERT INTO vendor_assurance_exception_controls
           (organization_id, exception_id, element_key, link_source, source_value)
         VALUES ($1,$2,'CC9.9','index_alignment','0')`,
        [seed.orgA.id, rows[0]!.id]
      )
    ).rejects.toThrow(/link_source_check/);
  });

  it("a 'human' link must name its human; an extracted one must not claim to have had one", async () => {
    const rows = (await pool.query(
      `SELECT id FROM vendor_assurance_exceptions WHERE organization_id=$1 AND superseded_at IS NULL LIMIT 1`,
      [seed.orgA.id]
    )).rows;
    await expect(
      pool.query(
        `INSERT INTO vendor_assurance_exception_controls
           (organization_id, exception_id, element_key, link_source, source_value)
         VALUES ($1,$2,'CC9.1','human','manual')`,
        [seed.orgA.id, rows[0]!.id]
      )
    ).rejects.toThrow(/authority_check/);
    await expect(
      pool.query(
        `INSERT INTO vendor_assurance_exception_controls
           (organization_id, exception_id, element_key, link_source, source_value, linked_by_user_id)
         VALUES ($1,$2,'CC9.2','extraction_control_refs','CC9.2',$3)`,
        [seed.orgA.id, rows[0]!.id, userA]
      )
    ).rejects.toThrow(/authority_check/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   LAYER 3 authority and the severity prohibition.
   ═══════════════════════════════════════════════════════════════════════ */

describe("LAYER 3 — the exception effect is a human determination with no severity", () => {
  let exceptionId = "";
  beforeAll(async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "l3-effect", {
      controls: [ctrl("CC8.1", "We were unable to test this control.")],
      exceptions: [
        {
          exception_ref: "Exception 2",
          control_refs: ["CC8.1"],
          description: "Records prior to 1 June 2025 were not available for inspection.",
          // The auditor files a SCOPE LIMITATION under the word "exception".
          // Representable, and the sharpest possible test of the ruling: the
          // governed effect must not be derived from the terminology.
          auditor_assessment:
            "Exception noted. Scope limitation applied — sufficient appropriate evidence was not available.",
        },
      ],
    });
    await approve(documentId, jwtA);
    for (let i = 0; i < 200 && exceptionId === ""; i += 1) {
      const rows = await liveExceptions(extractionId);
      if (rows.length > 0) exceptionId = rows[0]!.id;
      else await new Promise((r) => setTimeout(r, 25));
    }
  }, 60_000);

  it("a generic API key is refused at the human gate", async () => {
    const r = await decideExceptionEffect(exceptionId, null, { governed_effect: "scope_limitation" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("human_reviewer_required");
  });

  it("the database refuses an interpretation with no attributed human", async () => {
    await expect(
      pool.query(
        `UPDATE vendor_assurance_exceptions
            SET governed_effect='scope_limitation', effect_accepted_at=NOW(), effect_basis='{}'::jsonb
          WHERE id=$1`,
        [exceptionId]
      )
    ).rejects.toThrow(/no attributed human reviewer|effect_authority_check/);
  });

  it("A SCOPE LIMITATION IS NOT A CONTROL DEFICIENCY — the auditor said 'exception', the effect says otherwise", async () => {
    // The source terminology is "exception". A naive system would read that as
    // a deficiency. The auditor was describing evidence they could not obtain.
    const before = (await pool.query(
      `SELECT source_term FROM vendor_assurance_exceptions WHERE id=$1`, [exceptionId]
    )).rows[0]!;
    expect(before.source_term).toBe("exception");

    const r = await decideExceptionEffect(exceptionId, jwtA, {
      governed_effect: "scope_limitation",
      reviewer_note: "The auditor could not obtain evidence; the control itself was not shown to fail.",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.decided.governed_effect).toBe("scope_limitation");

    // The source's own word is preserved, untouched, and did not drive the answer.
    const after = (await pool.query(
      `SELECT source_term, governed_effect, effect_basis FROM vendor_assurance_exceptions WHERE id=$1`,
      [exceptionId]
    )).rows[0]!;
    expect(after.source_term).toBe("exception");
    expect(after.governed_effect).toBe("scope_limitation");
    expect(after.effect_basis.source.source_term_carries_no_severity).toBe(true);
  });

  it("re-deciding without supersede is a 409, not a silent overwrite", async () => {
    const r = await decideExceptionEffect(exceptionId, jwtA, { governed_effect: "control_deficiency" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("exception_effect_already_decided");
    expect(r.body.standing.governed_effect).toBe("scope_limitation");
  });

  it("the database refuses an effect outside the two-value vocabulary", async () => {
    await expect(
      pool.query(
        `UPDATE vendor_assurance_exceptions
            SET governed_effect='minor', effect_accepted_by_user_id=$2, effect_accepted_at=NOW(),
                effect_basis='{}'::jsonb
          WHERE id=$1`,
        [exceptionId, userA]
      )
    ).rejects.toThrow(/effect_vocabulary_check/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUIRED PROOF: cross-tenant.
   ═══════════════════════════════════════════════════════════════════════ */

describe("REQUIRED — cross-tenant read and write are denied", () => {
  let docA = "", extractionA = "", exceptionA = "";
  beforeAll(async () => {
    const d = await extractedDoc(seed.orgA.id, vendorA, "tenant-a", {
      controls: [ctrl("CC6.1", "Exception noted in Section IV.")],
      exceptions: [{ exception_ref: "E1", control_refs: ["CC6.1"], description: "a tenant-A exception" }],
    });
    docA = d.documentId; extractionA = d.extractionId;
    await approve(docA, jwtA);
    for (let i = 0; i < 200 && exceptionA === ""; i += 1) {
      const rows = await liveExceptions(extractionA);
      if (rows.length > 0) exceptionA = rows[0]!.id;
      else await new Promise((r) => setTimeout(r, 25));
    }
  }, 60_000);

  it("org B cannot READ org A's outcomes", async () => {
    const r = await outcomes(docA, jwtB);
    expect(r.status).toBe(404);
  });

  it("org B cannot decide effectiveness on org A's control", async () => {
    const r = await decideEffectiveness(docA, "CC6.1", jwtB, {
      effectiveness: "EFFECTIVE",
      reviewer_note: "cross-tenant attempt",
    });
    expect(r.status).toBe(404);
    const n = (await pool.query(
      `SELECT count(*)::int AS n FROM vendor_tested_control_effectiveness
        WHERE extraction_id=$1 AND organization_id=$2`,
      [extractionA, seed.orgB.id]
    )).rows[0]!.n;
    expect(n).toBe(0);
  });

  it("org B cannot interpret org A's exception", async () => {
    const r = await decideExceptionEffect(exceptionA, jwtB, { governed_effect: "control_deficiency" });
    expect(r.status).toBe(404);
    const still = (await pool.query(
      `SELECT governed_effect FROM vendor_assurance_exceptions WHERE id=$1`, [exceptionA]
    )).rows[0]!;
    expect(still.governed_effect).toBeNull();
  });

  it("RLS refuses a cross-tenant read on all three tables under the app role", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE app_request`);
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [seed.orgB.id]);
      for (const table of [
        "vendor_tested_control_assertions",
        "vendor_tested_control_effectiveness",
        "vendor_assurance_exceptions",
      ]) {
        const r = await client.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
          [seed.orgA.id]
        );
        expect(r.rows[0]!.n, `${table} leaked across tenants`).toBe(0);
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("RLS refuses a cross-tenant WRITE", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE app_request`);
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [seed.orgB.id]);
      await expect(
        client.query(
          `INSERT INTO vendor_tested_control_effectiveness
             (organization_id, document_id, extraction_id, element_key, decision,
              governed_effectiveness, accepted_by_user_id)
           VALUES ($1,$2,$3,'CC6.1','accepted','EFFECTIVE',$4)`,
          [seed.orgA.id, docA, extractionA, userA]
        )
      ).rejects.toThrow(/row-level security|violates/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUIRED PROOF: legacy readability and prompt-version reproducibility.
   ═══════════════════════════════════════════════════════════════════════ */

describe("REQUIRED — legacy extraction remains readable and prompt-version history reproducible", () => {
  it("a v2 extraction still materialises assertions and exceptions, unmodified in place", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "legacy-v2", {
      controls: [ctrl("A1.2", "Exception noted: for 2 of 30 sampled days, failed backup jobs were not investigated.")],
      exceptions: [
        { control_id: "A1.2", description: "SLA breach for backup investigation.", auditor_assessment: "Exception noted" },
      ],
      responses: [{ exception_ref: "A1.2", response: "Management stated the jobs were caused by a storage incident." }],
    });
    // Stamp it as the historical contract version.
    await pool.query(
      `UPDATE vendor_assurance_extractions SET prompt_version='soc-extraction-v2' WHERE id=$1`,
      [extractionId]
    );
    const before = (await pool.query(
      `SELECT fields FROM vendor_assurance_extractions WHERE id=$1`, [extractionId]
    )).rows[0]!.fields;

    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitAssertions(extractionId, 1);
    let exRows = await liveExceptions(extractionId);
    for (let i = 0; i < 200 && exRows.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      exRows = await liveExceptions(extractionId);
    }

    expect(exRows).toHaveLength(1);
    const links = await linksOf(exRows[0]!.id);
    expect(links[0]!.link_source).toBe("legacy_control_id");
    expect(links[0]!.element_key).toBe("A1.2");

    // NO DESTRUCTIVE REWRITE. The historical extracted source is byte-identical.
    const after = (await pool.query(
      `SELECT fields, prompt_version FROM vendor_assurance_extractions WHERE id=$1`, [extractionId]
    )).rows[0]!;
    expect(after.fields).toEqual(before);
    expect(after.prompt_version).toBe("soc-extraction-v2");
  });

  it("both prompt versions coexist, and each extraction keeps the one that produced it", async () => {
    const versions = (await pool.query(
      `SELECT DISTINCT prompt_version FROM vendor_assurance_extractions
        WHERE organization_id=$1 ORDER BY prompt_version`,
      [seed.orgA.id]
    )).rows.map((r) => r.prompt_version);
    expect(versions).toContain("soc-extraction-v2");
    expect(versions).toContain("soc-extraction-v3");
  });

  it("every assertion records the normalizer version that produced it", async () => {
    const r = (await pool.query(
      `SELECT count(*)::int AS n FROM vendor_tested_control_assertions
        WHERE organization_id=$1 AND (normalizer_version IS NULL OR normalizer_version='')`,
      [seed.orgA.id]
    )).rows[0]!;
    expect(r.n).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUIRED PROOF: synthetic fixture classification.
   ═══════════════════════════════════════════════════════════════════════ */

describe("REQUIRED — synthetic fixture data cannot masquerade as real corpus", () => {
  it("the classification column exists, is NOT NULL, and is closed", async () => {
    const col = (await pool.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name='organizations' AND column_name='tenant_class'`
    )).rows[0]!;
    expect(col.is_nullable).toBe("NO");
    expect(col.column_default).toMatch(/customer/);

    await expect(
      pool.query(`UPDATE organizations SET tenant_class='whatever' WHERE id=$1`, [seed.orgA.id])
    ).rejects.toThrow(/tenant_class_check/);
  });

  it("a synthetic tenant's evidence is EXCLUDED from a real-corpus measurement", async () => {
    const { realCorpusOrgPredicate } = await import("../../src/api/lib/tenantClass.js");
    await pool.query(`UPDATE organizations SET tenant_class='synthetic_fixture' WHERE id=$1`, [seed.orgB.id]);
    await pool.query(`UPDATE organizations SET tenant_class='customer' WHERE id=$1`, [seed.orgA.id]);

    // Org B gets a document with tested controls, exactly like a real one.
    const { extractionId } = await extractedDoc(seed.orgB.id, vendorB, "synthetic-corpus", {
      controls: [ctrl("CC6.1", "No exceptions noted.")],
    });
    await approve((await pool.query(
      `SELECT document_id FROM vendor_assurance_extractions WHERE id=$1`, [extractionId]
    )).rows[0]!.document_id, jwtB);

    const measured = (await pool.query(
      `SELECT count(*)::int AS n
         FROM vendor_tested_control_assertions a
         JOIN organizations o ON o.id = a.organization_id
        WHERE a.superseded_at IS NULL AND ${realCorpusOrgPredicate("o")}
          AND a.organization_id = $1`,
      [seed.orgB.id]
    )).rows[0]!;
    expect(measured.n).toBe(0);

    // Unfiltered, the same rows ARE there — so the exclusion is the predicate's
    // doing and not an empty table.
    const unfiltered = (await pool.query(
      `SELECT count(*)::int AS n FROM vendor_tested_control_assertions
        WHERE organization_id=$1 AND superseded_at IS NULL`,
      [seed.orgB.id]
    )).rows[0]!;
    expect(unfiltered.n).toBeGreaterThan(0);
  });

  it("the real-corpus predicate names no organization id — the mechanism the ruling forbade", async () => {
    const { realCorpusOrgPredicate, realCorpusOrgIdPredicate } = await import("../../src/api/lib/tenantClass.js");
    expect(realCorpusOrgPredicate("o")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(realCorpusOrgIdPredicate("x.organization_id")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});
