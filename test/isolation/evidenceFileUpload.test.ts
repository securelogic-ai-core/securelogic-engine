/**
 * evidenceFileUpload.test.ts — Remediation Evidence file upload + retrieval,
 * driven through the REAL routes over real Postgres. Blob storage (R2) is the ONE
 * mocked dependency — the harness has no R2, and the security properties under
 * test (tenant isolation, gate advancement, fail-closed persistence) are all in
 * the route + DB layer, not in the S3 client.
 *
 * Proves the goal's required behaviours:
 *   - successful upload persists a file-backed evidence row (name/type/size/sha256);
 *   - reference-only (JSON) evidence still works;
 *   - invalid MIME and content/magic mismatch are rejected with NO row created;
 *   - tenant isolation (cross-org source → 404; cross-org download → 404);
 *   - unauthorized upload is blocked;
 *   - an uploaded file is retrievable (302 → signed URL); reference-only has none;
 *   - the evidence gate advances the finding ONLY after the row persists;
 *   - a failed blob write creates NO false evidence record (and no gate advance).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

// ── Mock the blob storage boundary (no R2 in the harness). ──────────────────
const putSpy = vi.fn(async (args: { organizationId: string; evidenceId: string }) => ({
  key: `org/${args.organizationId}/evidence/${args.evidenceId}/original`,
  byteSize: 0,
}));
const signedSpy = vi.fn(async (args: { organizationId: string; evidenceId: string }) => ({
  url: `https://signed.example/${args.evidenceId}?sig=abc`,
  ttlSeconds: 90,
  expiresAt: new Date(1_800_000_000_000),
}));
const deleteSpy = vi.fn(async () => {});

vi.mock("../../src/api/lib/evidenceStorage.js", () => ({
  putEvidenceFile: (...a: unknown[]) => putSpy(...(a as [{ organizationId: string; evidenceId: string }])),
  getEvidenceFileSignedUrl: (...a: unknown[]) => signedSpy(...(a as [{ organizationId: string; evidenceId: string }])),
  deleteEvidenceFile: (...a: unknown[]) => deleteSpy(...(a as [never])),
  evidenceObjectKey: (orgId: string, evId: string) => `org/${orgId}/evidence/${evId}/original`,
}));

let seed: TestDbSeed;
let pool: Pool;
let app: Express;

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]); // %PDF-1.4
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function seedFinding(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'evidence-upload seed', 'manual', 'open') RETURNING id`,
    [orgId, title]
  );
  return r.rows[0]!.id;
}

async function seedClosedActionViaApi(orgId: string, apiKey: string, findingId: string): Promise<void> {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'remediate', 'finding', $2, 'near_term', 'in_progress') RETURNING id`,
    [orgId, findingId]
  );
  // Complete it through the real route so the finding recompute runs.
  await request(app).patch(`/api/actions/${a.rows[0]!.id}`).set("X-Api-Key", apiKey).send({ status: "closed" });
}

async function setEvidenceGate(orgId: string, on: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO risk_settings (organization_id, cadence_by_rating, require_evidence_gate)
     VALUES ($1, '{}'::jsonb, $2)
     ON CONFLICT (organization_id) DO UPDATE
       SET require_evidence_gate = EXCLUDED.require_evidence_gate, updated_at = NOW()`,
    [orgId, on]
  );
}

async function opStatus(findingId: string): Promise<string> {
  const r = await pool.query<{ operational_status: string }>(
    `SELECT operational_status FROM findings WHERE id = $1`,
    [findingId]
  );
  return r.rows[0]!.operational_status;
}

async function evidenceCount(orgId: string, findingId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM evidence
      WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2`,
    [orgId, findingId]
  );
  return parseInt(r.rows[0]!.n, 10);
}

function upload(apiKey: string | null, fields: Record<string, string>, fileOpts?: { buffer: Buffer; filename: string; contentType: string }) {
  let req = request(app).post("/api/evidence/upload");
  if (apiKey) req = req.set("X-Api-Key", apiKey);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  if (fileOpts) req = req.attach("file", fileOpts.buffer, { filename: fileOpts.filename, contentType: fileOpts.contentType });
  return req;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the evidence-upload test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("evidence file upload — happy path + gate advancement", () => {
  it("uploads a PDF, persists file metadata, and advances the gate-held finding to remediated", async () => {
    await setEvidenceGate(seed.orgA.id, true);
    const findingId = await seedFinding(seed.orgA.id, "upload-advances");
    await seedClosedActionViaApi(seed.orgA.id, seed.orgA.apiKey, findingId);
    // Gate holds it: all actions closed but no evidence yet.
    expect(await opStatus(findingId)).toBe("in_progress");

    putSpy.mockClear();
    const res = await upload(
      seed.orgA.apiKey,
      { source_type: "finding", source_id: findingId, title: "Patch log", evidence_type: "log" },
      { buffer: PDF_BYTES, filename: "patch.pdf", contentType: "application/pdf" }
    );
    expect(res.status).toBe(201);
    expect(res.body.evidence.has_file).toBe(true);
    expect(res.body.evidence.original_filename).toBe("patch.pdf");
    expect(res.body.evidence.mime_type).toBe("application/pdf");
    expect(res.body.evidence.byte_size).toBe(PDF_BYTES.length);
    expect(typeof res.body.evidence.sha256).toBe("string");
    expect(res.body.evidence).not.toHaveProperty("storage_key"); // key never exposed
    expect(putSpy).toHaveBeenCalledTimes(1);

    // The gate is satisfied → the finding advances, in the same flow.
    expect(await opStatus(findingId)).toBe("remediated");
  });

  it("reference-only (JSON) evidence still works and reports has_file=false", async () => {
    const findingId = await seedFinding(seed.orgA.id, "ref-only");
    const res = await request(app)
      .post("/api/evidence")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ source_type: "finding", source_id: findingId, title: "Change ticket CR-9", evidence_type: "document", external_ref: "https://tickets/CR-9" });
    expect(res.status).toBe(201);
    expect(res.body.evidence.has_file).toBe(false);
  });
});

describe("evidence file upload — validation & fail-closed", () => {
  it("rejects a disallowed MIME with NO row created", async () => {
    const findingId = await seedFinding(seed.orgA.id, "bad-mime");
    const res = await upload(
      seed.orgA.apiKey,
      { source_type: "finding", source_id: findingId, title: "x", evidence_type: "document" },
      { buffer: PDF_BYTES, filename: "x.exe", contentType: "application/x-msdownload" }
    );
    expect(res.status).toBe(415);
    expect(await evidenceCount(seed.orgA.id, findingId)).toBe(0);
  });

  it("rejects content that does not match the declared type (PNG bytes as PDF), NO row", async () => {
    const findingId = await seedFinding(seed.orgA.id, "magic-mismatch");
    const res = await upload(
      seed.orgA.apiKey,
      { source_type: "finding", source_id: findingId, title: "x", evidence_type: "document" },
      { buffer: PNG_BYTES, filename: "fake.pdf", contentType: "application/pdf" }
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("file_content_mismatch");
    expect(await evidenceCount(seed.orgA.id, findingId)).toBe(0);
  });

  it("a failed blob write creates NO false evidence record and does NOT advance the gate", async () => {
    await setEvidenceGate(seed.orgA.id, true);
    const findingId = await seedFinding(seed.orgA.id, "blob-fail-no-record");
    await seedClosedActionViaApi(seed.orgA.id, seed.orgA.apiKey, findingId);
    expect(await opStatus(findingId)).toBe("in_progress");

    putSpy.mockRejectedValueOnce(new Error("r2 down"));
    const res = await upload(
      seed.orgA.apiKey,
      { source_type: "finding", source_id: findingId, title: "Patch log", evidence_type: "log" },
      { buffer: PDF_BYTES, filename: "patch.pdf", contentType: "application/pdf" }
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("blob_put_failed");
    // No row, and the finding is still held by the gate — persistence never happened.
    expect(await evidenceCount(seed.orgA.id, findingId)).toBe(0);
    expect(await opStatus(findingId)).toBe("in_progress");
  });
});

describe("evidence file upload — authorization & tenant isolation", () => {
  it("blocks an unauthenticated upload", async () => {
    const findingId = await seedFinding(seed.orgA.id, "unauth");
    const res = await upload(
      null,
      { source_type: "finding", source_id: findingId, title: "x", evidence_type: "document" },
      { buffer: PDF_BYTES, filename: "x.pdf", contentType: "application/pdf" }
    );
    expect([401, 403]).toContain(res.status);
    expect(await evidenceCount(seed.orgA.id, findingId)).toBe(0);
  });

  it("org A cannot upload evidence onto org B's finding (404 source_not_found, no row, no blob)", async () => {
    const findingB = await seedFinding(seed.orgB.id, "iso-cross-org");
    putSpy.mockClear();
    const res = await upload(
      seed.orgA.apiKey,
      { source_type: "finding", source_id: findingB, title: "x", evidence_type: "document" },
      { buffer: PDF_BYTES, filename: "x.pdf", contentType: "application/pdf" }
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("source_record_not_found");
    expect(putSpy).not.toHaveBeenCalled(); // never stored bytes for a cross-org finding
    expect(await evidenceCount(seed.orgB.id, findingB)).toBe(0);
  });
});

describe("evidence file retrieval", () => {
  it("issues a 302 to a signed URL for the owner, and 404 across orgs", async () => {
    const findingId = await seedFinding(seed.orgA.id, "download");
    const up = await upload(
      seed.orgA.apiKey,
      { source_type: "finding", source_id: findingId, title: "Screenshot", evidence_type: "screenshot" },
      { buffer: PDF_BYTES, filename: "s.pdf", contentType: "application/pdf" }
    );
    expect(up.status).toBe(201);
    const evidenceId = up.body.evidence.id as string;

    signedSpy.mockClear();
    const owner = await request(app)
      .get(`/api/evidence/${evidenceId}/file`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .redirects(0);
    expect(owner.status).toBe(302);
    expect(owner.headers.location).toContain("signed.example");
    expect(signedSpy).toHaveBeenCalledTimes(1);

    // Cross-org download is a 404 — never a leak.
    const cross = await request(app)
      .get(`/api/evidence/${evidenceId}/file`)
      .set("X-Api-Key", seed.orgB.apiKey)
      .redirects(0);
    expect(cross.status).toBe(404);
  });

  it("returns 404 for a reference-only evidence row (no file to download)", async () => {
    const findingId = await seedFinding(seed.orgA.id, "ref-no-file");
    const created = await request(app)
      .post("/api/evidence")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ source_type: "finding", source_id: findingId, title: "link", evidence_type: "document", external_ref: "https://x" });
    const evidenceId = created.body.evidence.id as string;

    const res = await request(app)
      .get(`/api/evidence/${evidenceId}/file`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .redirects(0);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("evidence_has_no_file");
  });
});
