/**
 * testedControlResolution.test.ts — VA-S4-4C-2 against a real Postgres.
 *
 * The pure resolver is unit-tested elsewhere. What can only be proven here is
 * that the RECORD holds its shape: the authority CHECK, the two live-uniqueness
 * indexes, supersession rather than mutation, RLS, and the end-to-end path
 * where approving a document actually materialises the resolutions.
 *
 * The last group is the one that matters most: resolution must never be able to
 * fail an approval a human already made.
 */

process.env["JWT_SECRET"] ??= "test-jwt-secret-for-tested-control-resolution";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { ASSURANCE_BEARING_FIELD_NAMES } from "../../src/api/lib/vendorAssuranceValidation.js";
import { publishCanonicalControls } from "../../src/api/lib/controls/canonicalControlPublisher.js";
import { materializeTestedControlResolutions } from "../../src/api/lib/vendorAssurance/testedControlResolution.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let userA = "", userB = "", jwtA = "", jwtB = "", vendorA = "", vendorB = "";

const ctrl = (id: string, result = "No exceptions noted.") => ({
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
  opts: { controls?: ReturnType<typeof ctrl>[]; hint?: string | null; withExtraction?: boolean } = {}
): Promise<{ documentId: string; extractionId: string | null }> {
  const controls = opts.controls ?? [ctrl("CC6.1"), ctrl("CC6.2")];
  const hint = opts.hint === undefined ? "soc2_type2" : opts.hint;
  const d = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256,
        storage_key, mime_type, document_type_hint, processing_status)
     VALUES ($1,$2,$3,1024,$4,$5,'application/pdf',$6,'extracted') RETURNING id`,
    [orgId, vendorId, `${label}.pdf`, label.padEnd(64, "0").slice(0, 64), `k/${label}.pdf`, hint]
  );
  const documentId = d.rows[0]!.id;
  if (opts.withExtraction === false) return { documentId, extractionId: null };

  const fields: Record<string, unknown> = {
    controls: { value: controls, confidence: 0.99, status: "extracted" },
  };
  for (const f of ASSURANCE_BEARING_FIELD_NAMES) {
    if (f !== "controls") fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }
  const e = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_extractions (organization_id, document_id, model_id, prompt_version, fields)
     VALUES ($1,$2,'test-model','v1',$3::jsonb) RETURNING id`,
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

const live = async (extractionId: string) =>
  (await pool.query(
    `SELECT element_key, resolution_state, canonical_control_id, crosswalk_id,
            mapping_version, mapping_source, effective_source, override_id,
            original_control, effective_control, unmapped_reason,
            framework_key, framework_version, requirement_reference
       FROM vendor_tested_control_resolutions
      WHERE extraction_id = $1 AND superseded_at IS NULL
      ORDER BY element_key, canonical_control_id`,
    [extractionId]
  )).rows;

const allRows = async (extractionId: string) =>
  (await pool.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS superseded
       FROM vendor_tested_control_resolutions WHERE extraction_id = $1`,
    [extractionId]
  )).rows[0]!;

async function approve(id: string, jwt: string) {
  return request(app).post(`/api/vendor-assurance/documents/${id}/approve`).set("Authorization", `Bearer ${jwt}`).send({});
}

/** Resolution is fire-and-forget after the response; wait for it to land. */
async function awaitLive(extractionId: string, expected: number) {
  for (let i = 0; i < 200; i += 1) {
    const rows = await live(extractionId);
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return live(extractionId);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const uA = await seedUser(pool, seed.orgA.id, { email: "resolver-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "resolver-b@example.com" });
  userA = uA.id; userB = uB.id;
  for (const [u, org] of [[uA, seed.orgA.id], [uB, seed.orgB.id]] as const) {
    await recordAllCurrentConsents(pool, { userId: u.id, organizationId: org, consentMethod: "admin_recorded" });
  }
  jwtA = signJwt(userA, seed.orgA.id, "admin");
  jwtB = signJwt(userB, seed.orgB.id, "admin");
  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Resolver vendor A" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "Resolver vendor B" });

  // The governed crosswalk must actually exist for resolution to mean anything.
  await publishCanonicalControls(pool as never, { publishedByUserId: userA, apply: true });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 300_000);

afterAll(async () => { await pool?.end(); });

describe("approving a document materialises its resolution record", () => {
  it("resolves every tested control, with the governed mapping's provenance on each row", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-happy");
    const r = await approve(documentId, jwtA);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const rows = await awaitLive(extractionId!, 1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.framework_key).toBe("soc2");
      expect(row.framework_version).toBe("2017");
      expect(row.effective_source).toBe("extraction");
      expect(row.override_id).toBeNull();
      if (row.resolution_state === "resolved") {
        expect(row.canonical_control_id).not.toBeNull();
        expect(row.crosswalk_id).not.toBeNull();
        expect(row.mapping_version).not.toBeNull();
        expect(row.mapping_source).toBe("securelogic");
      }
    }
    expect(new Set(rows.map((x) => x.element_key))).toEqual(new Set(["CC6.1", "CC6.2"]));
  });

  it("FAN-OUT: CC6.1 produces several resolved rows under ONE element key", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-fanout", {
      controls: [ctrl("CC6.1")],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rows = await awaitLive(extractionId!, 2);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((x) => x.resolution_state === "resolved")).toBe(true);
    expect(new Set(rows.map((x) => x.canonical_control_id)).size).toBe(rows.length);
  });

  it("an identity with no published mapping is recorded UNMAPPED with a reason — not dropped", async () => {
    // PI1.1 is a real TSC 2017 processing-integrity criterion, deliberately not
    // curated in 4C-1 because nothing observed cites it.
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-unmapped", {
      controls: [ctrl("CC6.2"), ctrl("PI1.1")],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rows = await awaitLive(extractionId!, 2);
    const pi = rows.filter((x) => x.element_key === "PI1.1");
    expect(pi).toHaveLength(1);
    expect(pi[0]!.resolution_state).toBe("unmapped");
    expect(pi[0]!.unmapped_reason).toBe("no_published_crosswalk_mapping");
    expect(pi[0]!.canonical_control_id).toBeNull();
    expect(rows.some((x) => x.element_key === "CC6.2" && x.resolution_state === "resolved")).toBe(true);
  });

  it("C1.1 — the vendor-side-only criterion 4C-1 published — RESOLVES", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-c11", {
      controls: [ctrl("C1.1")],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rows = await awaitLive(extractionId!, 1);
    expect(rows.every((x) => x.resolution_state === "resolved")).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("the governed effective value, not just the extraction", () => {
  it("a live override supplies the effective control, and the original is preserved beside it", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-override", {
      controls: [ctrl("CC6.1", "No exceptions noted.")],
    });
    const ovr = await pool.query<{ id: string }>(
      `INSERT INTO vendor_assurance_field_overrides
         (organization_id, document_id, field_name, original_value, override_value, reason, overridden_by_user_id)
       VALUES ($1,$2,'controls',$3::jsonb,$4::jsonb,'reviewer correction',$5) RETURNING id`,
      [
        seed.orgA.id, documentId,
        JSON.stringify([ctrl("CC6.1", "No exceptions noted.")]),
        JSON.stringify([ctrl("CC6.1", "Exceptions noted — corrected by the reviewer.")]),
        userA,
      ]
    );
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rows = await awaitLive(extractionId!, 1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.effective_source).toBe("field_override");
      expect(row.override_id).toBe(ovr.rows[0]!.id);
      expect(row.effective_control.result).toMatch(/corrected by the reviewer/);
      // The immutable original extraction is still there, unrewritten.
      expect(row.original_control.result).toBe("No exceptions noted.");
    }
    const ext = await pool.query(`SELECT fields FROM vendor_assurance_extractions WHERE id=$1`, [extractionId]);
    expect(ext.rows[0]!.fields.controls.value[0].result).toBe("No exceptions noted.");
  });

  it("a control an override REMOVED has no live resolution — removal is a governance act with effect", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-removed", {
      controls: [ctrl("CC6.1"), ctrl("CC6.2")],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitLive(extractionId!, 2);

    await pool.query(
      `INSERT INTO vendor_assurance_field_overrides
         (organization_id, document_id, field_name, override_value, reason, overridden_by_user_id)
       VALUES ($1,$2,'controls',$3::jsonb,'CC6.2 was not actually tested',$4)`,
      [seed.orgA.id, documentId, JSON.stringify([ctrl("CC6.1")]), userA]
    );
    await materializeTestedControlResolutions(pool as never, {
      organizationId: seed.orgA.id, documentId,
    });
    const rows = await live(extractionId!);
    expect(new Set(rows.map((x) => x.element_key))).toEqual(new Set(["CC6.1"]));
    // ...and the removed control's row is HISTORY, not deleted.
    const history = await pool.query(
      `SELECT count(*)::int AS n FROM vendor_tested_control_resolutions
        WHERE extraction_id=$1 AND element_key='CC6.2' AND superseded_at IS NOT NULL`,
      [extractionId]
    );
    expect(history.rows[0]!.n).toBeGreaterThan(0);
  });
});

describe("re-resolution supersedes, it never mutates", () => {
  it("running twice leaves one live set and a growing history", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-idem", {
      controls: [ctrl("CC6.2")],
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const first = await awaitLive(extractionId!, 1);
    const before = await allRows(extractionId!);

    const out = await materializeTestedControlResolutions(pool as never, {
      organizationId: seed.orgA.id, documentId,
    });
    expect(out.ok).toBe(true);

    const second = await live(extractionId!);
    const after = await allRows(extractionId!);
    expect(second.map((x) => x.canonical_control_id).sort())
      .toEqual(first.map((x) => x.canonical_control_id).sort());
    expect(after.n).toBe(before.n + second.length);
    expect(after.superseded).toBe(before.n);
  });
});

describe("the record's shape is enforced by the database", () => {
  let extractionId = "";
  let controlId = "";
  let crosswalkId = "";
  let documentId = "";

  beforeAll(async () => {
    const d = await extractedDoc(seed.orgA.id, vendorA, "res-shape", { controls: [ctrl("CC6.2")] });
    documentId = d.documentId;
    extractionId = d.extractionId!;
    const m = await pool.query(
      `SELECT id, canonical_control_id FROM canonical_control_crosswalk
        WHERE framework_key='soc2' AND framework_version='2017' AND requirement_reference='CC6.2'
          AND status='published' LIMIT 1`
    );
    crosswalkId = m.rows[0]!.id;
    controlId = m.rows[0]!.canonical_control_id;
  });

  const insert = (cols: Record<string, unknown>) => {
    const base: Record<string, unknown> = {
      organization_id: seed.orgA.id,
      document_id: documentId,
      extraction_id: extractionId,
      element_key: "CC6.2",
      original_control: JSON.stringify(ctrl("CC6.2")),
      effective_control: JSON.stringify(ctrl("CC6.2")),
      effective_source: "extraction",
      framework_key: "soc2",
      framework_version: "2017",
      requirement_reference: "CC6.2",
      resolution_state: "resolved",
      canonical_control_id: controlId,
      crosswalk_id: crosswalkId,
      mapping_version: "2026.08.1",
      mapping_source: "securelogic",
      ...cols,
    };
    const keys = Object.keys(base);
    const casts = keys.map((k, i) =>
      k === "original_control" || k === "effective_control" ? `$${i + 1}::jsonb` : `$${i + 1}`
    );
    return pool.query(
      `INSERT INTO vendor_tested_control_resolutions (${keys.join(",")}) VALUES (${casts.join(",")})`,
      keys.map((k) => base[k])
    );
  };

  it("REFUSES a resolved row that names no governed mapping", async () => {
    await expect(insert({ crosswalk_id: null })).rejects.toMatchObject({ code: "23514" });
  });

  it("REFUSES a resolved row with an unmapped reason", async () => {
    await expect(insert({ unmapped_reason: "no_published_crosswalk_mapping" }))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("REFUSES an unmapped row that still names a canonical control", async () => {
    await expect(
      insert({ resolution_state: "unmapped", unmapped_reason: "no_published_crosswalk_mapping" })
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("REFUSES an unmapped row with no reason", async () => {
    await expect(
      insert({
        resolution_state: "unmapped", canonical_control_id: null, crosswalk_id: null,
        mapping_version: null, mapping_source: null,
      })
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("REFUSES an override-sourced row that names no override", async () => {
    await expect(insert({ effective_source: "field_override" })).rejects.toMatchObject({ code: "23514" });
  });

  it("REFUSES an unknown unmapped reason — the vocabulary is closed", async () => {
    await expect(
      insert({
        resolution_state: "unmapped", canonical_control_id: null, crosswalk_id: null,
        mapping_version: null, mapping_source: null, unmapped_reason: "looked_wrong",
      })
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("REFUSES the same (control, canonical control) pair live twice", async () => {
    await insert({ element_key: "CC6.2-dup" as unknown as string, requirement_reference: "CC6.2" });
    await expect(
      insert({ element_key: "CC6.2-dup" as unknown as string, requirement_reference: "CC6.2" })
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("REFUSES the same control recorded unmapped twice — NULLs would not collide on their own", async () => {
    const unmapped = {
      element_key: "ZZ9.9", requirement_reference: "ZZ9.9", resolution_state: "unmapped",
      canonical_control_id: null, crosswalk_id: null, mapping_version: null,
      mapping_source: null, unmapped_reason: "no_published_crosswalk_mapping",
    };
    await insert(unmapped);
    await expect(insert(unmapped)).rejects.toMatchObject({ code: "23505" });
  });
});

describe("resolution can never harm an approval, and never guesses a framework", () => {
  it("a SOC 1 report is NOT resolved against the Trust Services Criteria — and still approves", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-soc1", {
      controls: [ctrl("CC6.1")], hint: "soc1",
    });
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 400));
    expect(await live(extractionId!)).toEqual([]);

    const out = await materializeTestedControlResolutions(pool as never, {
      organizationId: seed.orgA.id, documentId,
    });
    expect(out).toMatchObject({ ok: false, reason: "framework_not_resolvable" });
  });

  it("a document with no extraction reports it rather than throwing", async () => {
    const { documentId } = await extractedDoc(seed.orgA.id, vendorA, "res-noext", { withExtraction: false });
    const out = await materializeTestedControlResolutions(pool as never, {
      organizationId: seed.orgA.id, documentId,
    });
    expect(out).toMatchObject({ ok: false, reason: "no_extraction" });
  });
});

describe("tenant isolation", () => {
  it("a foreign org cannot materialise resolutions for another org's document", async () => {
    const { documentId } = await extractedDoc(seed.orgA.id, vendorA, "res-xtenant");
    const out = await materializeTestedControlResolutions(pool as never, {
      organizationId: seed.orgB.id, documentId,
    });
    expect(out).toMatchObject({ ok: false, reason: "no_extraction" });
  });

  it("RLS hides one org's resolutions from another", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "res-rls");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitLive(extractionId!, 1);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id',$1,true)", [seed.orgB.id]);
      const r = await client.query(
        `SELECT count(*)::int AS n FROM vendor_tested_control_resolutions WHERE extraction_id=$1`,
        [extractionId]
      );
      expect(r.rows[0]!.n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("the vendor B tenant sees its OWN resolutions", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgB.id, vendorB, "res-own-b");
    expect((await approve(documentId, jwtB)).status).toBe(200);
    const rows = await awaitLive(extractionId!, 1);
    expect(rows.length).toBeGreaterThan(0);
  });
});
