/**
 * vendorAssuranceCuecGapRls.test.ts — the SOC 2 review finally reaches remediation.
 *
 * Before VA-1, 54 ingested documents had produced ZERO findings. Not because the
 * promotion code failed, but because `review_status` accepted only `pending` and
 * `reviewed_no_match` — a vocabulary that CONFLATES "this does not apply to us"
 * with "this applies and we do not do it". Nothing in the data model could
 * justify creating work.
 *
 * These tests run the determination against real Postgres with the real
 * constraints, because the guarantees being claimed are database guarantees: a
 * gap cannot be anonymous, a non-gap cannot carry a finding, and neither can
 * cross a tenant boundary.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

let vendorA: string;      // lower risk, clean outcome
let vendorB: string;      // higher risk, material gap
let docA: string;
let docB: string;
let controlImplemented: string;
let controlNotStarted: string;
let userA: string;

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

async function mkVendor(orgId: string, name: string, criticality: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name, criticality, framework_coverage, status)
     VALUES ($1,$2,$3,'{}','active') RETURNING id`,
    [orgId, name, criticality]);
  return r.rows[0]!.id;
}

async function mkDoc(orgId: string, vendorId: string, filename: string): Promise<string> {
  // The real NOT NULL set — a document is a stored artefact, not just a name.
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256,
        storage_key, mime_type, processing_status)
     VALUES ($1,$2,$3,1024,md5($3),'harness/'||$3,'application/pdf','extracted')
     RETURNING id`, [orgId, vendorId, filename]);
  return r.rows[0]!.id;
}

async function mkCuec(orgId: string, docId: string, ordinal: number, text: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_cuecs (organization_id, document_id, ordinal, cuec_text)
     VALUES ($1,$2,$3,$4) RETURNING id`, [orgId, docId, ordinal, text]);
  return r.rows[0]!.id;
}

async function mkControl(orgId: string, name: string, status: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name, implementation_status, status)
     VALUES ($1,$2,$3,'active') RETURNING id`, [orgId, name, status]);
  return r.rows[0]!.id;
}

/** Record a determination the way the route does: reviewer, timestamp, basis. */
async function determine(
  orgId: string, cuecId: string, status: string, reason: string | null, basis: unknown,
) {
  return pool.query(
    `UPDATE vendor_assurance_cuecs
        SET review_status = $3, review_status_reason = $4,
            review_status_updated_by_user_id = $5, review_status_updated_at = NOW(),
            gap_basis = $6::jsonb, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [cuecId, orgId, status, reason, userA, basis === null ? null : JSON.stringify(basis)]);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });

  const u = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE organization_id = $1 LIMIT 1`, [seed.orgA.id]);
  userA = u.rows[0]?.id ?? (await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, password_hash, role)
     VALUES ($1,'va-reviewer@harness.test','x','admin') RETURNING id`, [seed.orgA.id])).rows[0]!.id;

  vendorA = await mkVendor(seed.orgA.id, "Vendor A — low risk", "low");
  vendorB = await mkVendor(seed.orgA.id, "Vendor B — critical", "critical");
  docA = await mkDoc(seed.orgA.id, vendorA, "vendor-a-soc2-type2.pdf");
  docB = await mkDoc(seed.orgA.id, vendorB, "vendor-b-soc2-type2.pdf");
  controlImplemented = await mkControl(seed.orgA.id, "Access reviews", "implemented");
  controlNotStarted  = await mkControl(seed.orgA.id, "Encryption key rotation", "not_started");
});

afterAll(async () => { await pool?.end(); });

/* ── The state model ──────────────────────────────────────────────────────── */

describe("the review vocabulary can express a gap at all", () => {
  it("accepts the four determinations plus the deprecated legacy value", async () => {
    const c = await mkCuec(seed.orgA.id, docA, 90, "vocabulary probe");
    for (const s of ["not_applicable", "satisfied", "gap", "reviewed_no_match"]) {
      await expect(determine(seed.orgA.id, c, s, "because", null)).resolves.toBeTruthy();
    }
  });

  it("refuses a status outside the vocabulary", async () => {
    const c = await mkCuec(seed.orgA.id, docA, 91, "bad status probe");
    await expect(determine(seed.orgA.id, c, "definitely_fine", "x", null)).rejects.toThrow();
  });

  it("A GAP CANNOT BE ANONYMOUS — the database refuses one with no reviewer", async () => {
    // The whole point: AI extraction proposes the CUEC text, but only a person
    // can conclude the organisation is deficient.
    const c = await mkCuec(seed.orgA.id, docA, 92, "anonymous gap probe");
    await expect(pool.query(
      `UPDATE vendor_assurance_cuecs SET review_status = 'gap' WHERE id = $1`, [c],
    )).rejects.toThrow();
  });

  it("a pending row cannot carry reviewer detail", async () => {
    const c = await mkCuec(seed.orgA.id, docA, 93, "pending consistency probe");
    await expect(pool.query(
      `UPDATE vendor_assurance_cuecs
          SET review_status = 'pending', review_status_updated_at = NOW() WHERE id = $1`, [c],
    )).rejects.toThrow();
  });
});

/* ── Vendor A: clean outcome, no manufactured findings ───────────────────── */

describe("Vendor A — reviewed clean, and NO findings are manufactured", () => {
  it("records satisfied and not_applicable with their basis", async () => {
    const c1 = await mkCuec(seed.orgA.id, docA, 1, "Customer must review access quarterly.");
    const c2 = await mkCuec(seed.orgA.id, docA, 2, "Customer must operate its own physical security.");
    await determine(seed.orgA.id, c1, "satisfied", "Quarterly access reviews are in place.",
      { determined_status: "satisfied", mapped_controls: [{ control_id: controlImplemented, implementation_status: "implemented" }] });
    await determine(seed.orgA.id, c2, "not_applicable", "We hold no vendor-managed facilities.", { determined_status: "not_applicable", mapped_controls: [] });

    const r = await pool.query<{ review_status: string; gap_basis: unknown }>(
      `SELECT review_status, gap_basis FROM vendor_assurance_cuecs WHERE id = ANY($1::uuid[]) ORDER BY ordinal`,
      [[c1, c2]]);
    expect(r.rows.map((x) => x.review_status)).toEqual(["satisfied", "not_applicable"]);
    expect(r.rows[0]!.gap_basis).toBeTruthy();
  });

  it("produces no finding — a clean review must not invent work", async () => {
    const n = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM findings
        WHERE organization_id = $1 AND source_id = $2`, [seed.orgA.id, vendorA]);
    expect(Number(n.rows[0]!.n)).toBe(0);
  });

  it("a satisfied CUEC cannot carry a finding", async () => {
    const c = await mkCuec(seed.orgA.id, docA, 3, "satisfied promotion probe");
    await determine(seed.orgA.id, c, "satisfied", "in place", null);
    const f = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, source_type, source_id, title, severity, description, status)
       VALUES ($1,'vendor_review',$2,'probe','Low','x','open') RETURNING id`, [seed.orgA.id, vendorA]);
    await expect(pool.query(
      `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $2 WHERE id = $1`,
      [c, f.rows[0]!.id])).rejects.toThrow();
  });
});

/* ── Vendor B: material gap reaches remediation ──────────────────────────── */

describe("Vendor B — an applicable unsatisfied CUEC becomes remediation work", () => {
  let gapCuec: string;
  let findingId: string;

  it("records the gap with the control evidence behind it", async () => {
    gapCuec = await mkCuec(seed.orgA.id, docB, 1,
      "Customer is responsible for rotating encryption keys at least annually.");
    await determine(seed.orgA.id, gapCuec, "gap",
      "Key rotation is not implemented; the mapped control has not been started.",
      { determined_status: "gap",
        mapped_controls: [{ control_id: controlNotStarted, control_name: "Encryption key rotation",
                            implementation_status: "not_started" }],
        basis: "reviewer_judgement_with_mapped_controls" });

    const r = await pool.query<{ review_status: string; gap_basis: any; review_status_updated_by_user_id: string }>(
      `SELECT review_status, gap_basis, review_status_updated_by_user_id
         FROM vendor_assurance_cuecs WHERE id = $1`, [gapCuec]);
    expect(r.rows[0]!.review_status).toBe("gap");
    expect(r.rows[0]!.review_status_updated_by_user_id).toBe(userA);
    // The evidence is snapshotted — an auditor can see WHY, months later.
    expect(r.rows[0]!.gap_basis.mapped_controls[0].implementation_status).toBe("not_started");
  });

  it("promotes to an ORDINARY finding with a policy due date", async () => {
    await pool.query(
      `INSERT INTO risk_settings (organization_id, cadence_by_rating, finding_sla_by_severity)
       VALUES ($1,$2::jsonb,$3::jsonb)
       ON CONFLICT (organization_id) DO UPDATE SET finding_sla_by_severity = EXCLUDED.finding_sla_by_severity`,
      [seed.orgA.id, JSON.stringify({ High: 30 }), JSON.stringify({ Critical: 7, High: 14, Moderate: 30, Low: 90 })]);

    const { resolveSlaDueDateWith } = await import("../../src/api/lib/findingSlaPolicyRules.js");
    const due = await resolveSlaDueDateWith(pool, seed.orgA.id, "High");

    const f = await pool.query<{ id: string; due_date: string; source_type: string }>(
      `INSERT INTO findings
         (organization_id, source_type, source_id, title, severity, description, status,
          decision_state, operational_status, due_date)
       VALUES ($1,'vendor_review',$2,$3,'High',$4,'open','needs_review','open',$5)
       RETURNING id, due_date::text AS due_date, source_type`,
      [seed.orgA.id, vendorB, "CUEC not met: encryption key rotation",
       "Vendor B requires annual key rotation; review determined it is not met.", due]);
    findingId = f.rows[0]!.id;

    await pool.query(`UPDATE vendor_assurance_cuecs SET promoted_finding_id = $2 WHERE id = $1`,
      [gapCuec, findingId]);

    // The SAME SLA engine — no vendor-specific deadline logic.
    const expected = await pool.query<{ d: string }>(`SELECT (CURRENT_DATE + 14)::text AS d`);
    expect(f.rows[0]!.due_date).toBe(expected.rows[0]!.d);
    expect(f.rows[0]!.source_type).toBe("vendor_review");
  });

  it("the finding enters the ordinary lifecycle — Risk Register linkable", async () => {
    const risk = await pool.query<{ id: string }>(
      `INSERT INTO risks (organization_id, title, domain, likelihood, impact, risk_rating)
       VALUES ($1,'Third-party key management exposure','cyber','likely','High','High') RETURNING id`,
      [seed.orgA.id]);
    const link = await asOrg(seed.orgA.id, async (c) =>
      c.query(`INSERT INTO finding_risks (organization_id, finding_id, risk_id, link_type)
               VALUES ($1,$2,$3,'linked') RETURNING id`,
        [seed.orgA.id, findingId, risk.rows[0]!.id]));
    expect(link.rowCount).toBe(1);
  });

  it("accepts a risk exception WITHOUT pretending the condition disappeared", async () => {
    // The real column set: `rationale`, not `justification`. Left in `proposed`
    // — an approved acceptance additionally requires owner, approver, approved_at
    // and an expiry, enforced by a DB CHECK, which is the separation of duties
    // this platform deliberately keeps.
    const acc = await pool.query<{ id: string; kind: string }>(
      `INSERT INTO finding_risk_acceptances
         (organization_id, finding_id, kind, state, rationale, owner_user_id, requested_by_user_id)
       VALUES ($1,$2,'acceptance','proposed','Compensating control in place until Q4 migration.',$3,$3)
       RETURNING id, kind`, [seed.orgA.id, findingId, userA]);
    expect(acc.rows[0]!.kind).toBe("acceptance");
    // The CUEC is still a gap. Acceptance is a decision about the exposure, not
    // a claim that the vendor requirement is now met.
    const c = await pool.query<{ review_status: string }>(
      `SELECT review_status FROM vendor_assurance_cuecs WHERE id = $1`, [gapCuec]);
    expect(c.rows[0]!.review_status).toBe("gap");
  });

  it("promotion is idempotent — one CUEC cannot spawn two findings", async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM findings WHERE organization_id = $1 AND source_id = $2`,
      [seed.orgA.id, vendorB]);
    const already = await pool.query<{ promoted_finding_id: string }>(
      `SELECT promoted_finding_id FROM vendor_assurance_cuecs WHERE id = $1`, [gapCuec]);
    expect(already.rows[0]!.promoted_finding_id).toBe(findingId);
    const after = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM findings WHERE organization_id = $1 AND source_id = $2`,
      [seed.orgA.id, vendorB]);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("full provenance is reconstructable: vendor → document → CUEC → reviewer → finding", async () => {
    const r = await pool.query<Record<string, unknown>>(
      `SELECT v.name AS vendor, d.original_filename AS document, c.ordinal, c.cuec_text,
              c.review_status, c.review_status_reason, c.review_status_updated_by_user_id,
              f.id AS finding_id, f.severity, f.due_date
         FROM vendor_assurance_cuecs c
         JOIN vendor_assurance_documents d ON d.id = c.document_id
         JOIN vendors v ON v.id = d.vendor_id
         JOIN findings f ON f.id = c.promoted_finding_id
        WHERE c.id = $1`, [gapCuec]);
    const row = r.rows[0]!;
    expect(row["vendor"]).toBe("Vendor B — critical");
    expect(row["document"]).toBe("vendor-b-soc2-type2.pdf");
    expect(row["review_status"]).toBe("gap");
    expect(row["review_status_updated_by_user_id"]).toBe(userA);
    expect(row["finding_id"]).toBe(findingId);
  });
});

/* ── Tenant isolation ────────────────────────────────────────────────────── */

describe("tenant isolation across the whole chain", () => {
  it("Org A cannot see Org B's CUECs, documents or vendors", async () => {
    const bVendor = await mkVendor(seed.orgB.id, "Org B vendor", "high");
    const bDoc = await mkDoc(seed.orgB.id, bVendor, "org-b.pdf");
    const bCuec = await mkCuec(seed.orgB.id, bDoc, 1, "Org B CUEC");

    const rows = await asOrg(seed.orgA.id, async (c) => ({
      cuecs: (await c.query(`SELECT id FROM vendor_assurance_cuecs WHERE id = $1`, [bCuec])).rows,
      docs: (await c.query(`SELECT id FROM vendor_assurance_documents WHERE id = $1`, [bDoc])).rows,
      vendors: (await c.query(`SELECT id FROM vendors WHERE id = $1`, [bVendor])).rows,
    }));
    expect(rows.cuecs).toHaveLength(0);
    expect(rows.docs).toHaveLength(0);
    expect(rows.vendors).toHaveLength(0);
  });

  it("Org A cannot determine a gap on Org B's CUEC — identifier substitution refused", async () => {
    const bVendor = await mkVendor(seed.orgB.id, "Org B vendor 2", "high");
    const bDoc = await mkDoc(seed.orgB.id, bVendor, "org-b-2.pdf");
    const bCuec = await mkCuec(seed.orgB.id, bDoc, 1, "Org B CUEC 2");
    const n = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(
        `UPDATE vendor_assurance_cuecs SET review_status='gap', review_status_reason='forged',
              review_status_updated_at=NOW() WHERE id = $1`, [bCuec])).rowCount);
    expect(n).toBe(0);
    const still = await pool.query<{ review_status: string }>(
      `SELECT review_status FROM vendor_assurance_cuecs WHERE id = $1`, [bCuec]);
    expect(still.rows[0]!.review_status).toBe("pending");
  });

  it("WITH CHECK refuses a CUEC written into another tenant", async () => {
    await expect(asOrg(seed.orgA.id, async (c) =>
      c.query(`INSERT INTO vendor_assurance_cuecs (organization_id, document_id, ordinal, cuec_text)
               VALUES ($1,$2,99,'forged')`, [seed.orgB.id, docB]))).rejects.toThrow();
  });
});
