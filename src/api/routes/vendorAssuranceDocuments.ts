/**
 * vendorAssuranceDocuments.ts — Phase 1 vendor-assurance routes.
 *
 * Middleware on every route:
 *   vendorAssuranceFeatureFlag → requireApiKey → attachOrganizationContext
 *     → requireEntitlement("standard") → handler
 *
 * Mirrors vendors.ts entitlement exactly. Cross-org access returns 404.
 *
 * Routes:
 *   POST   /api/vendor-assurance/documents
 *   GET    /api/vendor-assurance/documents
 *   GET    /api/vendor-assurance/documents/:id
 *   GET    /api/vendor-assurance/documents/:id/extraction
 *   GET    /api/vendor-assurance/documents/:id/pdf
 *   POST   /api/vendor-assurance/extractions/:id/review-decisions
 *   POST   /api/vendor-assurance/documents/:id/finalize
 *
 * Append-only review decisions: each POST review-decisions INSERTs new rows.
 * Current decision per field is computed at read time via DISTINCT ON, never
 * persisted to a snapshot table.
 *
 * Handlers are exported by name so behavioral tests can invoke them with
 * mocked pg / mocked storage.
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { vendorAssuranceFeatureFlag } from "../lib/vendorAssuranceFeatureFlag.js";
import {
  validateUploadMetadata,
  validateReviewDecisions,
  computeFinalizePrecondition,
  isUuid,
  MAX_BYTE_SIZE
} from "../lib/vendorAssuranceValidation.js";
import {
  putVendorAssurancePdf,
  getVendorAssurancePdfSignedUrl
} from "../lib/vendorAssuranceStorage.js";
import { scheduleExtraction } from "../lib/vendorAssuranceExtractionRunner.js";
import { MATERIAL_FIELD_NAMES } from "../lib/socExtractionPrompt.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_STATUSES = new Set([
  "pending",
  "extracting",
  "extracted",
  "extraction_failed",
  "finalized"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  }
});

const DOC_SELECT = `
  id,
  organization_id,
  vendor_id,
  uploaded_by_user_id,
  original_filename,
  byte_size,
  sha256,
  storage_key,
  mime_type,
  document_type_hint,
  processing_status,
  processing_error_code,
  processing_error_detail,
  finalized_at,
  finalized_by_user_id,
  created_at,
  updated_at
`;

function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/* =========================================================
   POST /api/vendor-assurance/documents
   ========================================================= */
export async function uploadVendorAssuranceDocument(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "no_file_uploaded" });
    return;
  }

  const validated = validateUploadMetadata(req.body, req.file.originalname);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const meta = validated.input;

  // Pre-flight: vendor must belong to org. 404 (not 403) on cross-org.
  const vendorCheck = await pg.query(
    `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [meta.vendor_id, organizationId]
  );
  if ((vendorCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_not_found" });
    return;
  }

  const sha256 = createHash("sha256").update(req.file.buffer).digest("hex");

  // Insert the document row first to obtain an id; we then stream to R2 with
  // the id baked into the storage_key. If the R2 put fails, we mark the row
  // as extraction_failed:pdf_unparseable and return 500 — the caller should
  // re-upload.
  const insertResult = await pg.query<{ id: string; created_at: string }>(
    `INSERT INTO vendor_assurance_documents (
       organization_id, vendor_id, uploaded_by_user_id,
       original_filename, byte_size, sha256, storage_key,
       mime_type, document_type_hint, processing_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
     RETURNING id, created_at`,
    [
      organizationId,
      meta.vendor_id,
      req.userId ?? null,
      meta.original_filename,
      req.file.size,
      sha256,
      // placeholder; will be overwritten with the absolute key once we know id
      "pending",
      "application/pdf",
      meta.document_type_hint
    ]
  );
  const documentId = insertResult.rows[0]!.id;

  let storageKey: string;
  try {
    const putResult = await putVendorAssurancePdf({
      organizationId,
      documentId,
      bytes: req.file.buffer
    });
    storageKey = putResult.key;
  } catch (err) {
    // Rewind: mark the row failed so the operator/UI can see the cause.
    await pg.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'extraction_failed',
              processing_error_code = 'pdf_unparseable',
              processing_error_detail = $3,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [documentId, organizationId, `blob put: ${(err as Error)?.message ?? "failed"}`.slice(0, 4000)]
    );
    logger.error(
      { event: "vendor_assurance_blob_put_failed", organizationId, documentId, err },
      "Vendor-assurance PDF upload to R2 failed"
    );
    res.status(500).json({ error: "blob_put_failed" });
    return;
  }

  await pg.query(
    `UPDATE vendor_assurance_documents
        SET storage_key = $3, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [documentId, organizationId, storageKey]
  );

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.document.uploaded",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: {
      vendor_id: meta.vendor_id,
      byte_size: req.file.size,
      sha256,
      document_type_hint: meta.document_type_hint
    },
    ipAddress: req.ip ?? null
  });

  // Schedule extraction. setImmediate so the POST response is unblocked.
  scheduleExtraction({
    documentId,
    organizationId,
    documentTypeHint: meta.document_type_hint
  });

  const docResult = await pg.query(
    `SELECT ${DOC_SELECT} FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2`,
    [documentId, organizationId]
  );

  res.status(202).json({ document: docResult.rows[0] });
}

/* =========================================================
   GET /api/vendor-assurance/documents
   ========================================================= */
export async function listVendorAssuranceDocuments(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const limit = parseLimit(req.query["limit"]);
  const conditions: string[] = ["organization_id = $1"];
  const params: unknown[] = [organizationId];

  const vendorIdRaw = req.query["vendor_id"];
  if (isNonEmptyString(vendorIdRaw)) {
    if (!isUuid(vendorIdRaw)) {
      res.status(400).json({ error: "vendor_id_must_be_uuid" });
      return;
    }
    params.push(vendorIdRaw.trim());
    conditions.push(`vendor_id = $${params.length}`);
  }

  const statusRaw = req.query["status"];
  if (isNonEmptyString(statusRaw)) {
    const s = statusRaw.trim();
    if (!VALID_STATUSES.has(s)) {
      res.status(400).json({ error: "invalid_status_filter", allowed: [...VALID_STATUSES] });
      return;
    }
    params.push(s);
    conditions.push(`processing_status = $${params.length}`);
  }

  params.push(limit);
  const limitParam = params.length;

  const result = await pg.query(
    `SELECT ${DOC_SELECT}
       FROM vendor_assurance_documents
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParam}`,
    params
  );

  res.status(200).json({
    organizationId,
    count: result.rows.length,
    limit,
    documents: result.rows
  });
}

/* =========================================================
   GET /api/vendor-assurance/documents/:id
   ========================================================= */
export async function getVendorAssuranceDocument(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) {
    res.status(400).json({ error: "document_id_must_be_uuid" });
    return;
  }

  const result = await pg.query(
    `SELECT ${DOC_SELECT} FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2`,
    [documentId, organizationId]
  );
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }
  res.status(200).json({ document: result.rows[0] });
}

/* =========================================================
   GET /api/vendor-assurance/documents/:id/extraction
   Reads extraction + spans + current-decision-per-field projection.
   ========================================================= */
export async function getVendorAssuranceExtraction(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) {
    res.status(400).json({ error: "document_id_must_be_uuid" });
    return;
  }

  // Verify the document exists and belongs to org. 404 on cross-org.
  const docCheck = await pg.query(
    `SELECT 1 FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((docCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }

  const extractionResult = await pg.query<{
    id: string;
    organization_id: string;
    document_id: string;
    model_id: string;
    prompt_version: string;
    raw_response_excerpt: string | null;
    fields: unknown;
    created_at: string;
  }>(
    `SELECT id, organization_id, document_id, model_id, prompt_version,
            raw_response_excerpt, fields, created_at
       FROM vendor_assurance_extractions
      WHERE document_id = $1 AND organization_id = $2`,
    [documentId, organizationId]
  );
  if ((extractionResult.rowCount ?? 0) === 0) {
    res.status(200).json({ extraction: null, spans: [], current_decisions: {} });
    return;
  }
  const extraction = extractionResult.rows[0]!;

  const spansResult = await pg.query(
    `SELECT id, organization_id, extraction_id, field_name, page_number,
            char_start, char_end, quote, created_at
       FROM vendor_assurance_extraction_spans
      WHERE extraction_id = $1 AND organization_id = $2
      ORDER BY field_name ASC, page_number ASC NULLS LAST, char_start ASC`,
    [extraction.id, organizationId]
  );

  const decisionsResult = await pg.query<{
    field_name: string;
    decision: "accept" | "edit" | "reject";
    reviewed_value: unknown;
    reviewer_note: string | null;
    decided_by_user_id: string | null;
    decided_at: string;
    id: string;
  }>(
    `SELECT DISTINCT ON (field_name)
            field_name, decision, reviewed_value, reviewer_note,
            decided_by_user_id, decided_at, id
       FROM vendor_assurance_review_decisions
      WHERE extraction_id = $1 AND organization_id = $2
      ORDER BY field_name, decided_at DESC, id DESC`,
    [extraction.id, organizationId]
  );

  const currentDecisions: Record<string, {
    decision: "accept" | "edit" | "reject";
    reviewed_value: unknown;
    reviewer_note: string | null;
    decided_by_user_id: string | null;
    decided_at: string;
  }> = {};
  for (const row of decisionsResult.rows) {
    currentDecisions[row.field_name] = {
      decision: row.decision,
      reviewed_value: row.reviewed_value,
      reviewer_note: row.reviewer_note,
      decided_by_user_id: row.decided_by_user_id,
      decided_at: row.decided_at
    };
  }

  res.status(200).json({
    extraction,
    spans: spansResult.rows,
    current_decisions: currentDecisions,
    material_field_names: MATERIAL_FIELD_NAMES
  });
}

/* =========================================================
   GET /api/vendor-assurance/documents/:id/pdf
   302 to a single-org pre-signed URL with TTL ≤ 60s.
   ========================================================= */
export async function getVendorAssurancePdfRedirect(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) {
    res.status(400).json({ error: "document_id_must_be_uuid" });
    return;
  }

  const docCheck = await pg.query(
    `SELECT 1 FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((docCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }

  let signed: { url: string; ttlSeconds: number; expiresAt: Date };
  try {
    signed = await getVendorAssurancePdfSignedUrl({ organizationId, documentId });
  } catch (err) {
    logger.error(
      { event: "vendor_assurance_signed_url_failed", organizationId, documentId, err },
      "Vendor-assurance signed URL issuance failed"
    );
    res.status(500).json({ error: "signed_url_failed" });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.document.pdf_url_issued",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: { ttl_seconds: signed.ttlSeconds, expires_at: signed.expiresAt.toISOString() },
    ipAddress: req.ip ?? null
  });

  res.redirect(302, signed.url);
}

/* =========================================================
   POST /api/vendor-assurance/extractions/:id/review-decisions
   Append-only INSERT of one or more decision rows.
   ========================================================= */
export async function recordVendorAssuranceReviewDecisions(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const extractionId = String(req.params["id"] ?? "").trim();
  if (!isUuid(extractionId)) {
    res.status(400).json({ error: "extraction_id_must_be_uuid" });
    return;
  }

  const validated = validateReviewDecisions(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { decisions } = validated.input;

  // Verify the extraction belongs to org and pull its document_id for audit context.
  const extractionCheck = await pg.query<{ document_id: string }>(
    `SELECT document_id FROM vendor_assurance_extractions
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [extractionId, organizationId]
  );
  if ((extractionCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_extraction_not_found" });
    return;
  }
  const documentId = extractionCheck.rows[0]!.document_id;

  // Refuse to record decisions on a finalized document — finalize is terminal.
  const docStatus = await pg.query<{ processing_status: string }>(
    `SELECT processing_status FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if (docStatus.rows[0]?.processing_status === "finalized") {
    res.status(409).json({ error: "vendor_assurance_document_finalized" });
    return;
  }

  // Bulk INSERT — append-only, one new row per decision in the body.
  const insertedIds: string[] = [];
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    for (const d of decisions) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO vendor_assurance_review_decisions
           (organization_id, extraction_id, field_name, decision,
            reviewed_value, reviewer_note, decided_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING id`,
        [
          organizationId,
          extractionId,
          d.field_name,
          d.decision,
          d.reviewed_value === null ? null : JSON.stringify(d.reviewed_value),
          d.reviewer_note,
          req.userId ?? null
        ]
      );
      insertedIds.push(ins.rows[0]!.id);
    }
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    logger.error(
      { event: "vendor_assurance_review_decisions_insert_failed", organizationId, extractionId, err },
      "Review decisions insert failed"
    );
    res.status(500).json({ error: "review_decisions_insert_failed" });
    return;
  } finally {
    client.release();
  }

  for (const d of decisions) {
    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "vendor_assurance.review_decision.recorded",
      resourceType: "vendor_assurance_extraction",
      resourceId: extractionId,
      payload: {
        document_id: documentId,
        field_name: d.field_name,
        decision: d.decision
      },
      ipAddress: req.ip ?? null
    });
  }

  // Read back the recomputed current-decision-per-field projection.
  const projection = await pg.query<{
    field_name: string;
    decision: "accept" | "edit" | "reject";
    reviewed_value: unknown;
    reviewer_note: string | null;
    decided_by_user_id: string | null;
    decided_at: string;
  }>(
    `SELECT DISTINCT ON (field_name)
            field_name, decision, reviewed_value, reviewer_note,
            decided_by_user_id, decided_at
       FROM vendor_assurance_review_decisions
      WHERE extraction_id = $1 AND organization_id = $2
      ORDER BY field_name, decided_at DESC, id DESC`,
    [extractionId, organizationId]
  );
  const currentDecisions: Record<string, unknown> = {};
  for (const row of projection.rows) {
    currentDecisions[row.field_name] = row;
  }

  res.status(200).json({
    inserted_ids: insertedIds,
    current_decisions: currentDecisions
  });
}

/* =========================================================
   POST /api/vendor-assurance/documents/:id/finalize
   Precondition: every material field has a current decision.
   Idempotent re-call returns 409.
   ========================================================= */
export async function finalizeVendorAssuranceDocument(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) {
    res.status(400).json({ error: "document_id_must_be_uuid" });
    return;
  }

  const docResult = await pg.query<{ id: string; processing_status: string }>(
    `SELECT id, processing_status FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((docResult.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }
  const doc = docResult.rows[0]!;
  if (doc.processing_status === "finalized") {
    res.status(409).json({ error: "vendor_assurance_document_already_finalized" });
    return;
  }
  if (doc.processing_status !== "extracted") {
    res.status(409).json({ error: "vendor_assurance_document_not_extracted", status: doc.processing_status });
    return;
  }

  const extractionResult = await pg.query<{ id: string }>(
    `SELECT id FROM vendor_assurance_extractions
      WHERE document_id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((extractionResult.rowCount ?? 0) === 0) {
    res.status(409).json({ error: "vendor_assurance_extraction_missing" });
    return;
  }
  const extractionId = extractionResult.rows[0]!.id;

  const projection = await pg.query<{ field_name: string; decision: "accept" | "edit" | "reject" }>(
    `SELECT DISTINCT ON (field_name) field_name, decision
       FROM vendor_assurance_review_decisions
      WHERE extraction_id = $1 AND organization_id = $2
      ORDER BY field_name, decided_at DESC, id DESC`,
    [extractionId, organizationId]
  );
  const currentMap: Record<string, { decision: "accept" | "edit" | "reject" }> = {};
  for (const row of projection.rows) {
    currentMap[row.field_name] = { decision: row.decision };
  }

  const precondition = computeFinalizePrecondition(currentMap);
  if (!precondition.ok) {
    res.status(409).json({
      error: "vendor_assurance_finalize_blocked",
      missing_field_names: precondition.missing_field_names
    });
    return;
  }

  const update = await pg.query(
    `UPDATE vendor_assurance_documents
        SET processing_status = 'finalized',
            finalized_at = NOW(),
            finalized_by_user_id = $3,
            updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
        AND processing_status = 'extracted'
      RETURNING ${DOC_SELECT}`,
    [documentId, organizationId, req.userId ?? null]
  );
  if ((update.rowCount ?? 0) === 0) {
    // Lost a race with another finalize call.
    res.status(409).json({ error: "vendor_assurance_document_already_finalized" });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.document.finalized",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: {
      extraction_id: extractionId,
      decided_field_count: Object.keys(currentMap).length
    },
    ipAddress: req.ip ?? null
  });

  res.status(200).json({ document: update.rows[0] });
}

/* =========================================================
   Multer error handler — translate file-size and unsupported-type errors
   into the canonical 413 / 400 responses for the upload route.
   ========================================================= */
function multerErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: (e?: unknown) => void
): void {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: string }).message ?? "";
    if (m === "unsupported_file_type") {
      res.status(400).json({ error: "unsupported_file_type" });
      return;
    }
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "file_too_large", max_bytes: MAX_BYTE_SIZE });
      return;
    }
  }
  next(err);
}

// ---------------------------------------------------------------------------
// Router wiring
// ---------------------------------------------------------------------------

router.post(
  "/vendor-assurance/documents",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  upload.single("document"),
  multerErrorHandler,
  uploadVendorAssuranceDocument
);

router.get(
  "/vendor-assurance/documents",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  listVendorAssuranceDocuments
);

router.get(
  "/vendor-assurance/documents/:id",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  getVendorAssuranceDocument
);

router.get(
  "/vendor-assurance/documents/:id/extraction",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  getVendorAssuranceExtraction
);

router.get(
  "/vendor-assurance/documents/:id/pdf",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  getVendorAssurancePdfRedirect
);

router.post(
  "/vendor-assurance/extractions/:id/review-decisions",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  recordVendorAssuranceReviewDecisions
);

router.post(
  "/vendor-assurance/documents/:id/finalize",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  finalizeVendorAssuranceDocument
);

export default router;
