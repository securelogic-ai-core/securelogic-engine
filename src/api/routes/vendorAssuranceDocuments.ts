/**
 * vendorAssuranceDocuments.ts — Phase 1 vendor-assurance routes.
 *
 * Middleware on every route:
 *   vendorAssuranceFeatureFlag → requireApiKey → attachOrganizationContext
 *     → requireEntitlement("premium") → handler
 *
 * Mirrors vendors.ts entitlement exactly (rank 4 / premium — Platform pillar,
 * §D entitlement reconciliation). Cross-org access returns 404.
 *
 * Routes:
 *   POST   /api/vendor-assurance/documents
 *   GET    /api/vendor-assurance/documents
 *   GET    /api/vendor-assurance/documents/:id
 *   GET    /api/vendor-assurance/documents/:id/extraction
 *   GET    /api/vendor-assurance/documents/:id/pdf
 *   POST   /api/vendor-assurance/documents/:id/export.xlsx
 *   POST   /api/vendor-assurance/documents/:id/export.pdf
 *   POST   /api/vendor-assurance/extractions/:id/review-decisions
 *   POST   /api/vendor-assurance/documents/:id/finalize          (legacy)
 *   POST   /api/vendor-assurance/documents/:id/field-overrides
 *   POST   /api/vendor-assurance/documents/:id/approve
 *   POST   /api/vendor-assurance/documents/:id/request-manual-review
 *   POST   /api/vendor-assurance/documents/:id/reject
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
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  classifyStorageFailure,
  STORAGE_FAILURE_DETAIL,
} from "../lib/blobStorageReadiness.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { vendorAssuranceFeatureFlag } from "../lib/vendorAssuranceFeatureFlag.js";
import {
  validateUploadMetadata,
  validateReviewDecisions,
  validateFieldOverrideBody,
  validateRejectBody,
  validateManualReviewBody,
  validateCreateCuecMappingBody,
  validateUpdateCuecMappingBody,
  validateUpdateCuecReviewStatusBody,
  computeFinalizePrecondition,
  isUuid,
  MAX_BYTE_SIZE,
  MAX_ORG_STORAGE_BYTES
} from "../lib/vendorAssuranceValidation.js";
import {
  putVendorAssurancePdf,
  getVendorAssurancePdfSignedUrl
} from "../lib/vendorAssuranceStorage.js";
import { MATERIAL_FIELD_NAMES } from "../lib/socExtractionPrompt.js";
import { sqlAssuranceReviewed } from "../lib/metricDefinitions.js";
import {
  refreshCuecMappingsForDocument,
  MATCH_SCORE_MIN_THRESHOLD,
  MATCH_SCORE_HIGH_CONFIDENCE
} from "../lib/vendorAssuranceCuecMatcher.js";
import { loadCuecsWithMappings, buildExportBundle } from "../lib/vendorAssuranceExportData.js";
// VA-1: the SAME SLA engine every other finding uses. Vendor Assurance gets no
// bespoke deadline logic — a vendor gap is a finding, and the org's policy
// decides its due date exactly as it does for a pen-test result or a control gap.
import { resolveSlaDueDate } from "../lib/findingSlaPolicy.js";
import { buildVendorAssuranceWorkbookBuffer, workbookDownloadFilename } from "../lib/vendorAssuranceExcelExporter.js";
import { buildVendorAssurancePdf, pdfDownloadFilename } from "../lib/vendorAssurancePdfExporter.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_STATUSES = new Set([
  "pending",
  "extracting",
  "extracted",
  "extraction_failed",
  "finalized",
  "approved",
  "manual_review_requested",
  "rejected"
]);

/**
 * Pseudo-status accepted by the ?status= list filter. Not a column value —
 * it expands to `processing_status IN ('approved','finalized')` via
 * sqlAssuranceReviewed(). See ASSURANCE_REVIEWED_STATUSES for why the reviewed
 * population is two values and must never be hardcoded as one.
 */
const ASSURANCE_REVIEWED_FILTER = "reviewed";

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

// "%PDF" — the first 4 bytes of every valid PDF, regardless of version.
// Magic-byte check runs in the handler because multer's fileFilter only
// receives metadata, not the buffer.
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

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
  approved_at,
  approved_by_user_id,
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
  if (req.file.buffer.length < 4 || !req.file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
    res.status(400).json({ error: "invalid_pdf_content" });
    return;
  }

  const validated = validateUploadMetadata(req.body, req.file.originalname);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const meta = validated.input;

  // Captured once: the DB steps below run inside withTenant callbacks, and TS
  // cannot carry the `req.file` narrowing across a closure boundary.
  const uploadedFile = req.file;

  // A04-G1 tenant scoping for this handler is EXPLICIT withTenant, not an
  // asTenant route wrap. The handler streams file bytes to R2 in the middle of
  // its DB work; an asTenant wrap would hold one tenant transaction open across
  // that upload. Instead each DB step opens its own short scope, bracketing the
  // R2 put — so the connection is never held across external I/O and every query
  // still runs with app.current_org_id set for RLS.

  // Pre-flight: vendor must belong to org. 404 (not 403) on cross-org.
  const vendorCheck = await withTenant(organizationId, () =>
    pg.query(
      `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [meta.vendor_id, organizationId]
    )
  );
  if ((vendorCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_not_found" });
    return;
  }

  // A05-G2: per-org cumulative R2 storage quota. SUM only the rows whose bytes
  // actually landed in R2. storage_key is the discriminator, NOT
  // processing_status: a row keeps the literal placeholder 'pending' as its
  // storage_key iff the R2 put never succeeded (the catch path below returns
  // before the storage_key UPDATE), so 'org/%' keys are exactly the rows with
  // bytes in R2. This correctly splits 'extraction_failed': a runner-stage
  // failure has a real 'org/...' key and counts; an R2-put failure keeps
  // 'pending' and does not. The SUM-then-INSERT is deliberately non-atomic —
  // concurrent uploads can overshoot by up to one max-size file each; that is
  // acceptable for a soft storage cap.
  const usage = await withTenant(organizationId, () =>
    pg.query<{ total_bytes: string; document_count: string }>(
      `SELECT COALESCE(SUM(byte_size), 0)::text AS total_bytes,
              COUNT(*)::text                    AS document_count
         FROM vendor_assurance_documents
        WHERE organization_id = $1
          AND storage_key LIKE 'org/%'`,
      [organizationId]
    )
  );
  const usedBytes = Number(usage.rows[0]?.total_bytes ?? "0");
  const documentCount = Number(usage.rows[0]?.document_count ?? "0");
  if (usedBytes + req.file.size > MAX_ORG_STORAGE_BYTES) {
    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "vendor_assurance.document.upload_quota_rejected",
      resourceType: "vendor_assurance_document",
      resourceId: null,
      payload: {
        used_bytes: usedBytes,
        limit_bytes: MAX_ORG_STORAGE_BYTES,
        document_count: documentCount
      },
      ipAddress: req.ip ?? null
    });
    res.status(409).json({
      error: "org_storage_quota_exceeded",
      used_bytes: usedBytes,
      limit_bytes: MAX_ORG_STORAGE_BYTES,
      document_count: documentCount
    });
    return;
  }

  const sha256 = createHash("sha256").update(req.file.buffer).digest("hex");

  // Insert the document row first to obtain an id; we then stream to R2 with
  // the id baked into the storage_key. If the R2 put fails, the row is marked
  // extraction_failed with a STORAGE error code (SL-EVID-1) — never
  // `pdf_unparseable`, which would tell the customer their document was
  // corrupt when the document was never read.
  const insertResult = await withTenant(organizationId, () =>
    pg.query<{ id: string; created_at: string }>(
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
      uploadedFile.size,
      sha256,
      // placeholder; will be overwritten with the absolute key once we know id
      "pending",
      "application/pdf",
      meta.document_type_hint
    ]
    )
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
    // SL-EVID-1: classify before recording. The bytes never reached storage, so
    // nothing here is evidence about the PDF — the failure belongs to the
    // storage layer and is recorded as such.
    const verdict = classifyStorageFailure(err);

    // Rewind: mark the row failed so the operator/UI can see the cause. The
    // detail is customer-visible on the document page, so it carries the
    // classification, never the SDK message (which names R2 env vars).
    await withTenant(organizationId, () =>
      pg.query(
        `UPDATE vendor_assurance_documents
            SET processing_status = 'extraction_failed',
                processing_error_code = $4,
                processing_error_detail = $3,
                updated_at = NOW()
          WHERE id = $1 AND organization_id = $2`,
        [
          documentId,
          organizationId,
          STORAGE_FAILURE_DETAIL[verdict.documentErrorCode],
          verdict.documentErrorCode,
        ]
      )
    );
    logger.error(
      {
        event: "vendor_assurance_blob_put_failed",
        organizationId,
        documentId,
        storage_failure_kind: verdict.kind,
        err,
      },
      "Vendor-assurance PDF upload to object storage failed"
    );
    res.status(verdict.httpStatus).json({ error: verdict.apiError });
    return;
  }

  await withTenant(organizationId, () =>
    pg.query(
      `UPDATE vendor_assurance_documents
          SET storage_key = $3, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [documentId, organizationId, storageKey]
    )
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

  // Enqueue a durable extraction job on the generic `jobs` table (Pillar 1,
  // §E step 4). The vendor-extraction worker claims and runs it out-of-process,
  // so an engine redeploy can no longer strand a document mid-extraction the way
  // the old in-process setImmediate(scheduleExtraction) runner did. The web
  // process does NO Claude work. Payload keys (documentId/documentTypeHint) are
  // exactly what the worker's resolveDocumentId reads; status/scheduled_for/
  // attempts/max_attempts use the table defaults. job_type is permitted by the
  // step-1 CHECK migration (20260622).
  try {
    await withTenant(organizationId, () =>
      pg.query(
        `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
         VALUES ($1, $2, 'vendor_assurance_extract',
                 jsonb_build_object('documentId', $3::text, 'documentTypeHint', $4::text))`,
        [organizationId, req.userId ?? null, documentId, meta.document_type_hint]
      )
    );
  } catch (err) {
    // Durable enqueue failed (e.g. transient DB fault). The document row and its
    // R2 object are intact, so this is NOT a content failure — leave the row
    // 'pending' (do not mislabel it extraction_failed) and surface a 500 so the
    // client can retry the upload. Failing closed here is the whole point of the
    // durable queue: a lost enqueue must be visible, never silently dropped.
    logger.error(
      { event: "vendor_assurance_extraction_enqueue_failed", organizationId, documentId, err },
      "Failed to enqueue vendor-assurance extraction job"
    );
    res.status(500).json({ error: "extraction_enqueue_failed" });
    return;
  }

  const docResult = await withTenant(organizationId, () =>
    pg.query(
      `SELECT ${DOC_SELECT} FROM vendor_assurance_documents
        WHERE id = $1 AND organization_id = $2`,
      [documentId, organizationId]
    )
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
    // 'reviewed' is a PSEUDO-STATUS, not a column value: it means "a human
    // accepted this extraction", which is `approved OR finalized` (see
    // ASSURANCE_REVIEWED_STATUSES). Callers that want the latest reviewed
    // document must use it rather than naming a raw state — hardcoding
    // 'finalized' is dead on the current flow and hardcoding 'approved' drops
    // legacy reviewed rows.
    if (s === ASSURANCE_REVIEWED_FILTER) {
      conditions.push(sqlAssuranceReviewed());
    } else if (!VALID_STATUSES.has(s)) {
      res.status(400).json({
        error: "invalid_status_filter",
        allowed: [...VALID_STATUSES, ASSURANCE_REVIEWED_FILTER]
      });
      return;
    } else {
      params.push(s);
      conditions.push(`processing_status = $${params.length}`);
    }
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
  // Current override per material field (latest by overridden_at). Document-
  // scoped — independent of whether an extraction exists, though the override
  // route refuses to record one without an extraction.
  const overridesResult = await pg.query<{
    field_name: string;
    original_value: unknown;
    override_value: unknown;
    reason: string;
    overridden_by_user_id: string | null;
    overridden_at: string;
  }>(
    `SELECT DISTINCT ON (field_name)
            field_name, original_value, override_value, reason,
            overridden_by_user_id, overridden_at
       FROM vendor_assurance_field_overrides
      WHERE document_id = $1 AND organization_id = $2
      ORDER BY field_name, overridden_at DESC, id DESC`,
    [documentId, organizationId]
  );
  const fieldOverrides = overridesResult.rows;

  if ((extractionResult.rowCount ?? 0) === 0) {
    res.status(200).json({
      extraction: null,
      spans: [],
      current_decisions: {},
      field_overrides: fieldOverrides,
      material_field_names: MATERIAL_FIELD_NAMES
    });
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
    field_overrides: fieldOverrides,
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

  // A04-G1: explicit withTenant, not an asTenant route wrap — this handler ends
  // in a 302 redirect, and asTenant's buffering proxy throws on a handler that
  // does anything but status()+json(). The scope closes before the signed-URL
  // issuance so no tenant connection is held across the S3/R2 round trip.
  const docCheck = await withTenant(organizationId, () =>
    pg.query(
      `SELECT 1 FROM vendor_assurance_documents
        WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [documentId, organizationId]
    )
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
   Shared helper for the document-presentation document-level actions:
   approve / request-manual-review / reject. All three require the document
   to be in 'extracted' state, mutate it to a target status (and conditionally
   set approved_at / approved_by_user_id), and audit. The UPDATE re-asserts
   processing_status = 'extracted' so a lost race returns 409 rather than a
   double transition.
   ========================================================= */
async function transitionExtractedDocument(
  req: Request,
  res: Response,
  opts: {
    targetStatus: "approved" | "manual_review_requested" | "rejected";
    setApproved: boolean;
    eventType: string;
    auditPayload: Record<string, unknown>;
  }
): Promise<void> {
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
  if (doc.processing_status !== "extracted") {
    res.status(409).json({
      error: "vendor_assurance_document_not_extracted",
      status: doc.processing_status
    });
    return;
  }

  const update = opts.setApproved
    ? await pg.query(
        `UPDATE vendor_assurance_documents
            SET processing_status = $3,
                approved_at = NOW(),
                approved_by_user_id = $4,
                updated_at = NOW()
          WHERE id = $1 AND organization_id = $2
            AND processing_status = 'extracted'
          RETURNING ${DOC_SELECT}`,
        [documentId, organizationId, opts.targetStatus, req.userId ?? null]
      )
    : await pg.query(
        `UPDATE vendor_assurance_documents
            SET processing_status = $3,
                updated_at = NOW()
          WHERE id = $1 AND organization_id = $2
            AND processing_status = 'extracted'
          RETURNING ${DOC_SELECT}`,
        [documentId, organizationId, opts.targetStatus]
      );
  if ((update.rowCount ?? 0) === 0) {
    // Lost a race — another request already moved it out of 'extracted'.
    res.status(409).json({ error: "vendor_assurance_document_not_extracted" });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: opts.eventType,
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: opts.auditPayload,
    ipAddress: req.ip ?? null
  });

  res.status(200).json({ document: update.rows[0] });
}

/* =========================================================
   POST /api/vendor-assurance/documents/:id/field-overrides
   Append-only INSERT of one reviewer override of an extracted material field,
   with a REQUIRED reason. original_value is captured at write time from
   whatever was currently displayed for the field — the latest prior override
   if one exists, else the original extraction value — so a chain of overrides
   keeps a faithful "what the reviewer saw before each change" trail.
   Refused on approved / rejected / finalized documents (locked states).
   ========================================================= */
export async function recordVendorAssuranceFieldOverride(req: Request, res: Response): Promise<void> {
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

  const validated = validateFieldOverrideBody(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { field_name, override_value, reason } = validated.input;

  const docResult = await pg.query<{ id: string; processing_status: string }>(
    `SELECT id, processing_status FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((docResult.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }
  const status = docResult.rows[0]!.processing_status;
  // Locked states: 'rejected' (terminal), 'approved' (terminal-success / the
  // version of record — correcting it requires a future explicit re-open
  // action, out of scope here), and the legacy 'finalized'.
  // 'manual_review_requested' stays editable — that is the state where a human
  // reviewer corrects fields.
  if (status === "rejected" || status === "approved" || status === "finalized") {
    res.status(409).json({ error: "vendor_assurance_document_not_overridable", status });
    return;
  }

  // Capture the value the reviewer is overriding, i.e. whatever is currently
  // displayed for this field: the latest prior override if one exists, else the
  // original extraction value. An override requires an extraction to exist; the
  // field itself may legitimately carry a null value (model missed it) — that
  // is still overridable. A prior override implies the extraction exists.
  const priorOverride = await pg.query<{ override_value: unknown }>(
    `SELECT override_value FROM vendor_assurance_field_overrides
      WHERE document_id = $1 AND organization_id = $2 AND field_name = $3
      ORDER BY overridden_at DESC, id DESC
      LIMIT 1`,
    [documentId, organizationId, field_name]
  );

  let originalValue: unknown;
  if ((priorOverride.rowCount ?? 0) > 0) {
    originalValue = priorOverride.rows[0]!.override_value;
  } else {
    const extractionResult = await pg.query<{ fields: Record<string, { value?: unknown }> | null }>(
      `SELECT fields FROM vendor_assurance_extractions
        WHERE document_id = $1 AND organization_id = $2 LIMIT 1`,
      [documentId, organizationId]
    );
    if ((extractionResult.rowCount ?? 0) === 0) {
      res.status(409).json({ error: "vendor_assurance_extraction_missing" });
      return;
    }
    const fields = extractionResult.rows[0]!.fields ?? {};
    originalValue = fields[field_name]?.value ?? null;
  }

  let inserted: { id: string; overridden_at: string };
  try {
    const ins = await pg.query<{ id: string; overridden_at: string }>(
      `INSERT INTO vendor_assurance_field_overrides
         (organization_id, document_id, field_name, original_value, override_value, reason, overridden_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING id, overridden_at`,
      [
        organizationId,
        documentId,
        field_name,
        originalValue === null || originalValue === undefined ? null : JSON.stringify(originalValue),
        override_value === null || override_value === undefined ? null : JSON.stringify(override_value),
        reason,
        req.userId ?? null
      ]
    );
    inserted = ins.rows[0]!;
  } catch (err) {
    logger.error(
      { event: "vendor_assurance_field_override_insert_failed", organizationId, documentId, field_name, err },
      "Vendor-assurance field override insert failed"
    );
    res.status(500).json({ error: "field_override_insert_failed" });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.field.overridden",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: {
      field_name,
      original_value: originalValue,
      override_value,
      reason
    },
    ipAddress: req.ip ?? null
  });

  // If the CUEC list itself was just overridden, the vendor_assurance_cuecs
  // rows and their mappings are now stale. Rebuild + re-match in the background
  // (setImmediate keeps the response fast; failure is non-fatal — the Re-match
  // button is the recovery path). The override route itself is not otherwise
  // changed by this package.
  if (field_name === "cuecs") {
    setImmediate(() => {
      void refreshCuecMappingsForDocument(documentId, organizationId, { resyncRows: true }).catch((err) => {
        logger.error(
          { event: "vendor_assurance_cuec_rematch_after_override_failed", organizationId, documentId, err: (err as Error)?.message ?? "unknown" },
          "CUEC re-match after cuecs override failed (non-fatal)"
        );
      });
    });
  }

  res.status(201).json({
    override: {
      id: inserted.id,
      document_id: documentId,
      field_name,
      original_value: originalValue,
      override_value,
      reason,
      overridden_by_user_id: req.userId ?? null,
      overridden_at: inserted.overridden_at
    }
  });
}

/* =========================================================
   POST /api/vendor-assurance/documents/:id/approve
   extracted → approved. Conceptual replacement for the legacy finalize flow.
   ========================================================= */
export async function approveVendorAssuranceDocument(req: Request, res: Response): Promise<void> {
  await transitionExtractedDocument(req, res, {
    targetStatus: "approved",
    setApproved: true,
    eventType: "vendor_assurance.document.approved",
    auditPayload: {}
  });
}

/* =========================================================
   POST /api/vendor-assurance/documents/:id/request-manual-review { comment? }
   extracted → manual_review_requested. NOT terminal.
   ========================================================= */
export async function requestVendorAssuranceManualReview(req: Request, res: Response): Promise<void> {
  const validated = validateManualReviewBody(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  await transitionExtractedDocument(req, res, {
    targetStatus: "manual_review_requested",
    setApproved: false,
    eventType: "vendor_assurance.document.manual_review_requested",
    auditPayload: { comment: validated.input.comment }
  });
}

/* =========================================================
   POST /api/vendor-assurance/documents/:id/reject { reason }
   extracted → rejected. Terminal.
   ========================================================= */
export async function rejectVendorAssuranceDocument(req: Request, res: Response): Promise<void> {
  const validated = validateRejectBody(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  await transitionExtractedDocument(req, res, {
    targetStatus: "rejected",
    setApproved: false,
    eventType: "vendor_assurance.document.rejected",
    auditPayload: { reason: validated.input.reason }
  });
}

/* =========================================================
   CUEC matcher package: cuec rows + N:M control mappings
   ========================================================= */

// loadCuecsWithMappings moved to ../lib/vendorAssuranceExportData.ts (shared with the export builders).

/* GET /api/vendor-assurance/documents/:id/cuecs */
export async function getVendorAssuranceCuecs(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }

  // A04-G1: explicit withTenant rather than an asTenant route wrap — this
  // handler already opens its own scope for loadCuecsWithMappings below, and
  // withTenant takes a FRESH pool connection per call, so an outer wrap would
  // double-connect and nest a second transaction for no benefit.
  const docCheck = await withTenant(organizationId, () =>
    pg.query(
      `SELECT 1 FROM vendor_assurance_documents WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [documentId, organizationId]
    )
  );
  if ((docCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }

  const cuecs = await withTenant(organizationId, () =>
    loadCuecsWithMappings(documentId, organizationId)
  );
  res.status(200).json({
    document_id: documentId,
    cuecs,
    match_score_min_threshold: MATCH_SCORE_MIN_THRESHOLD,
    match_score_high_confidence: MATCH_SCORE_HIGH_CONFIDENCE
  });
}

/* POST /api/vendor-assurance/documents/:id/rematch-cuecs */
export async function rematchVendorAssuranceCuecs(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }

  // A04-G1: explicit withTenant, not an asTenant route wrap. This handler calls
  // the LLM CUEC matcher, which runs for seconds; an asTenant wrap would hold
  // the tenant transaction open across that round trip. Each DB step opens its
  // own scope and commits before the matcher runs — the same commit-then-compute
  // discipline ask.ts follows for the same reason.
  const docCheck = await withTenant(organizationId, () =>
    pg.query(
      `SELECT 1 FROM vendor_assurance_documents WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [documentId, organizationId]
    )
  );
  if ((docCheck.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }

  // If cuec rows were never written (extraction-time matcher failed entirely),
  // bootstrap them from the extraction first — that path can't destroy any
  // mappings because there aren't any yet. When rows already exist, do NOT
  // resync (a resync DELETE-then-INSERTs the cuec rows and would cascade away
  // the user's accepted/dismissed mappings); just re-run the matcher, which
  // preserves user actions and only replaces 'suggested' rows.
  const cuecCountRes = await withTenant(organizationId, () =>
    pg.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_assurance_cuecs WHERE document_id = $1 AND organization_id = $2`,
      [documentId, organizationId]
    )
  );
  const hasCuecRows = Number(cuecCountRes.rows[0]?.n ?? "0") > 0;

  let result;
  try {
    result = await refreshCuecMappingsForDocument(documentId, organizationId, { resyncRows: !hasCuecRows });
  } catch (err) {
    logger.error(
      { event: "vendor_assurance_cuec_rematch_failed", organizationId, documentId, err: (err as Error)?.message ?? "unknown" },
      "CUEC re-match failed"
    );
    res.status(500).json({ error: "cuec_rematch_failed" });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.cuecs.rematched",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: { ...result },
    ipAddress: req.ip ?? null
  });

  const cuecs = await withTenant(organizationId, () =>
    loadCuecsWithMappings(documentId, organizationId)
  );
  res.status(200).json({
    document_id: documentId,
    cuecs,
    result,
    match_score_min_threshold: MATCH_SCORE_MIN_THRESHOLD,
    match_score_high_confidence: MATCH_SCORE_HIGH_CONFIDENCE
  });
}

/* Shared: fetch one mapping joined to its control, scoped to org. */
async function fetchCuecMappingJoined(mappingId: string, organizationId: string): Promise<Record<string, unknown> | null> {
  const r = await pg.query<Record<string, unknown>>(
    `SELECT m.id, m.cuec_id, m.control_id, m.mapping_status, m.mapping_score, m.mapping_source,
            m.reason, m.created_by_user_id, m.updated_by_user_id, m.created_at, m.updated_at,
            c.name AS control_name, c.description AS control_description, c.status AS control_status
       FROM vendor_assurance_cuec_control_mappings m
       JOIN controls c ON c.id = m.control_id AND c.organization_id = m.organization_id
      WHERE m.id = $1 AND m.organization_id = $2
      LIMIT 1`,
    [mappingId, organizationId]
  );
  return r.rows[0] ?? null;
}

/* POST /api/vendor-assurance/cuecs/:cuecId/mappings — user creates a manual accepted mapping. */
export async function createVendorAssuranceCuecMapping(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const cuecId = String(req.params["cuecId"] ?? "").trim();
  if (!isUuid(cuecId)) { res.status(400).json({ error: "cuec_id_must_be_uuid" }); return; }

  const validated = validateCreateCuecMappingBody(req.body);
  if ("error" in validated) { res.status(400).json(validated); return; }
  const { control_id, reason } = validated.input;

  // cuec must belong to org
  const cuecCheck = await pg.query<{ document_id: string }>(
    `SELECT document_id FROM vendor_assurance_cuecs WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [cuecId, organizationId]
  );
  if ((cuecCheck.rowCount ?? 0) === 0) { res.status(404).json({ error: "vendor_assurance_cuec_not_found" }); return; }
  const documentId = cuecCheck.rows[0]!.document_id;

  // control must belong to org
  const ctlCheck = await pg.query(
    `SELECT 1 FROM controls WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [control_id, organizationId]
  );
  if ((ctlCheck.rowCount ?? 0) === 0) { res.status(404).json({ error: "control_not_found" }); return; }

  // Insert as a manual accepted mapping. If a row already exists for this
  // (cuec, control) pair: a 'suggested' or already-'accepted' row is flipped /
  // left at 'accepted' (treating "add this control" as "accept it"); a
  // 'dismissed' row is left untouched and the request is refused (re-suggesting
  // a dismissed pair is an explicit future action, out of scope).
  const ins = await pg.query<{ id: string }>(
    `INSERT INTO vendor_assurance_cuec_control_mappings
       (organization_id, cuec_id, control_id, mapping_status, mapping_score, mapping_source, reason, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, 'accepted', NULL, 'manual', $4, $5, $5)
     ON CONFLICT (cuec_id, control_id) DO UPDATE
       SET mapping_status = 'accepted', updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
       WHERE vendor_assurance_cuec_control_mappings.mapping_status <> 'dismissed'
     RETURNING id`,
    [organizationId, cuecId, control_id, reason, req.userId ?? null]
  );
  if ((ins.rowCount ?? 0) === 0) {
    res.status(409).json({ error: "vendor_assurance_cuec_mapping_dismissed" });
    return;
  }
  const mappingId = ins.rows[0]!.id;

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.cuec_mapping.created",
    resourceType: "vendor_assurance_cuec",
    resourceId: cuecId,
    payload: { document_id: documentId, control_id, mapping_status: "accepted", mapping_source: "manual" },
    ipAddress: req.ip ?? null
  });

  const mapping = await fetchCuecMappingJoined(mappingId, organizationId);
  res.status(201).json({ mapping });
}

/* PATCH /api/vendor-assurance/cuec-mappings/:mappingId — accept a suggestion / dismiss a mapping. */
export async function updateVendorAssuranceCuecMapping(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const mappingId = String(req.params["mappingId"] ?? "").trim();
  if (!isUuid(mappingId)) { res.status(400).json({ error: "mapping_id_must_be_uuid" }); return; }

  const validated = validateUpdateCuecMappingBody(req.body);
  if ("error" in validated) { res.status(400).json(validated); return; }
  const target = validated.input.mapping_status;
  const reason = validated.input.reason;

  // mapping must belong to org (verified via JOIN to vendor_assurance_cuecs)
  const cur = await pg.query<{ cuec_id: string; control_id: string; mapping_status: string; document_id: string }>(
    `SELECT m.cuec_id, m.control_id, m.mapping_status, c.document_id
       FROM vendor_assurance_cuec_control_mappings m
       JOIN vendor_assurance_cuecs c ON c.id = m.cuec_id AND c.organization_id = m.organization_id
      WHERE m.id = $1 AND m.organization_id = $2
      LIMIT 1`,
    [mappingId, organizationId]
  );
  if ((cur.rowCount ?? 0) === 0) { res.status(404).json({ error: "vendor_assurance_cuec_mapping_not_found" }); return; }
  const { cuec_id, control_id, mapping_status: from, document_id } = cur.rows[0]!;

  // Idempotent self-transition.
  if (from === target) {
    const mapping = await fetchCuecMappingJoined(mappingId, organizationId);
    res.status(200).json({ mapping });
    return;
  }
  // Legal transitions: suggested→accepted, suggested→dismissed, accepted→dismissed.
  const legal =
    (from === "suggested" && (target === "accepted" || target === "dismissed")) ||
    (from === "accepted" && target === "dismissed");
  if (!legal) {
    res.status(409).json({ error: "invalid_cuec_mapping_transition", from, to: target });
    return;
  }

  const upd = await pg.query<{ id: string }>(
    `UPDATE vendor_assurance_cuec_control_mappings
        SET mapping_status = $3,
            reason = $4,
            updated_by_user_id = $5,
            updated_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND mapping_status = $6
      RETURNING id`,
    [mappingId, organizationId, target, target === "dismissed" ? reason : null, req.userId ?? null, from]
  );
  if ((upd.rowCount ?? 0) === 0) {
    // Lost a race — status changed under us.
    res.status(409).json({ error: "invalid_cuec_mapping_transition", from, to: target });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.cuec_mapping.updated",
    resourceType: "vendor_assurance_cuec",
    resourceId: cuec_id,
    payload: { document_id, control_id, from, to: target, ...(target === "dismissed" && reason ? { reason } : {}) },
    ipAddress: req.ip ?? null
  });

  const mapping = await fetchCuecMappingJoined(mappingId, organizationId);
  res.status(200).json({ mapping });
}

/* POST /api/vendor-assurance/cuecs/:cuecId/review-status — record the review outcome.
 *
 * VA-1. This is where a SOC 2 review becomes actionable, or explicitly does not.
 * The reviewer decides one of:
 *
 *   not_applicable  the CUEC does not apply to this organisation
 *   satisfied       it applies and this organisation meets it
 *   gap             it applies and this organisation does NOT meet it
 *   pending         clear the determination (back to unreviewed)
 *
 * A GAP IS A HUMAN DETERMINATION. Extraction proposes the CUEC text; only an
 * authenticated reviewer can conclude the organisation is deficient. The DB
 * CHECK enforces that every determined state carries a reviewer and a
 * timestamp, so no code path can produce an anonymous gap.
 *
 * THE BASIS IS SNAPSHOTTED. `gap_basis` records the accepted control mappings
 * and their implementation_status AT THIS MOMENT. Controls change; a
 * determination made today must remain explainable to an auditor later, and
 * recomputing it then would silently rewrite what the reviewer actually saw.
 */
export async function updateVendorAssuranceCuecReviewStatus(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const cuecId = String(req.params["cuecId"] ?? "").trim();
  if (!isUuid(cuecId)) { res.status(400).json({ error: "cuec_id_must_be_uuid" }); return; }

  const validated = validateUpdateCuecReviewStatusBody(req.body);
  if ("error" in validated) { res.status(400).json(validated); return; }
  const { review_status, reason } = validated.input;

  const cur = await pg.query<{ document_id: string; promoted_finding_id: string | null }>(
    `SELECT document_id, promoted_finding_id
       FROM vendor_assurance_cuecs WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [cuecId, organizationId]
  );
  if ((cur.rowCount ?? 0) === 0) { res.status(404).json({ error: "vendor_assurance_cuec_not_found" }); return; }
  const documentId = cur.rows[0]!.document_id;

  // A determination that already produced a Finding is not silently re-decided.
  // The Finding may already carry an owner, a due date and remediation work;
  // flipping the CUEC underneath it would orphan that work with no trace.
  // Nullish, not strict-null: a projection that omits the column yields
  // `undefined`, and treating that as "already promoted" would refuse a
  // perfectly ordinary review.
  if (cur.rows[0]!.promoted_finding_id != null && review_status !== "gap") {
    res.status(409).json({
      error: "cuec_already_promoted",
      detail:
        "This gap has already been promoted to a finding. Resolve or withdraw " +
        "that finding first — changing the determination underneath it would " +
        "leave remediation work with nothing explaining why it exists."
    });
    return;
  }

  const isPending = review_status === "pending";

  // Snapshot the evidence behind the determination: which controls this CUEC is
  // mapped to (accepted mappings only — suggestions are not evidence) and what
  // state those controls were in when the reviewer decided.
  let gapBasis: string | null = null;
  if (!isPending) {
    const mapped = await pg.query<{
      control_id: string; control_name: string; implementation_status: string | null;
      maturity_level: string | null; last_tested_at: string | null;
    }>(
      `SELECT c.id AS control_id, c.name AS control_name, c.implementation_status,
              c.maturity_level, c.last_tested_at::text AS last_tested_at
         FROM vendor_assurance_cuec_control_mappings m
         JOIN controls c ON c.id = m.control_id AND c.organization_id = m.organization_id
        WHERE m.organization_id = $1 AND m.cuec_id = $2 AND m.mapping_status = 'accepted'
        ORDER BY c.name`,
      [organizationId, cuecId]
    );
    gapBasis = JSON.stringify({
      determined_at: new Date().toISOString(),
      determined_status: review_status,
      mapped_controls: mapped.rows,
      mapped_control_count: mapped.rowCount ?? 0,
      // Recorded explicitly so a later reader knows the reviewer decided with no
      // mapped control, rather than that the mapping was lost.
      basis: (mapped.rowCount ?? 0) === 0
        ? "reviewer_judgement_no_mapped_control"
        : "reviewer_judgement_with_mapped_controls"
    });
  }

  const upd = await pg.query<{
    id: string; ordinal: number; cuec_text: string; review_status: string;
    review_status_reason: string | null; review_status_updated_by_user_id: string | null;
    review_status_updated_at: string | null; gap_basis: unknown;
    promoted_finding_id: string | null; created_at: string; updated_at: string;
  }>(
    isPending
      ? `UPDATE vendor_assurance_cuecs
            SET review_status = 'pending', review_status_reason = NULL,
                review_status_updated_by_user_id = NULL, review_status_updated_at = NULL,
                gap_basis = NULL, promoted_finding_id = NULL, updated_at = NOW()
          WHERE id = $1 AND organization_id = $2
          RETURNING id, ordinal, cuec_text, review_status, review_status_reason,
                    review_status_updated_by_user_id, review_status_updated_at,
                    gap_basis, promoted_finding_id, created_at, updated_at`
      : `UPDATE vendor_assurance_cuecs
            SET review_status = $3, review_status_reason = $4,
                review_status_updated_by_user_id = $5, review_status_updated_at = NOW(),
                gap_basis = $6::jsonb, updated_at = NOW()
          WHERE id = $1 AND organization_id = $2
          RETURNING id, ordinal, cuec_text, review_status, review_status_reason,
                    review_status_updated_by_user_id, review_status_updated_at,
                    gap_basis, promoted_finding_id, created_at, updated_at`,
    isPending
      ? [cuecId, organizationId]
      : [cuecId, organizationId, review_status, reason, req.userId ?? null, gapBasis]
  );
  if ((upd.rowCount ?? 0) === 0) { res.status(404).json({ error: "vendor_assurance_cuec_not_found" }); return; }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.cuec.review_status_updated",
    resourceType: "vendor_assurance_cuec",
    resourceId: cuecId,
    payload: {
      document_id: documentId,
      review_status,
      ...(reason ? { reason } : {}),
      ...(gapBasis ? { basis: JSON.parse(gapBasis) } : {})
    },
    ipAddress: req.ip ?? null
  });

  res.status(200).json({ cuec: upd.rows[0] });
}

/* POST /api/vendor-assurance/cuecs/:cuecId/promote-to-finding
 *
 * VA-1 — THE CONNECTION THAT WAS MISSING. 54 documents had been ingested and
 * ZERO findings had ever come out of the document path, because a reviewed CUEC
 * had nowhere to go. This is where a vendor's stated requirement that the
 * organisation does not meet becomes ordinary remediation work.
 *
 * IT IS AN ORDINARY FINDING. Same table, same two-axis lifecycle, same SLA
 * engine, same Risk Register relationship, same evidence, same closure gates.
 * No Vendor Findings v2, no parallel remediation table, no vendor-specific
 * deadline logic.
 *
 * PROMOTION IS EXPLICIT, NOT AUTOMATIC. A gap determination and the decision to
 * open remediation work are two different acts by design: an organisation may
 * legitimately record that it does not meet a CUEC and decide, deliberately, not
 * to act on it yet. Auto-promoting would remove that judgement and would mean a
 * reviewer's click silently created work with an owner and a deadline.
 *
 * IDEMPOTENT. promoted_finding_id is set on the CUEC and checked first, so a
 * double-click or a retried request returns the existing finding rather than
 * creating a second one for the same requirement.
 */
export async function promoteVendorAssuranceCuecToFinding(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const cuecId = String(req.params["cuecId"] ?? "").trim();
  if (!isUuid(cuecId)) { res.status(400).json({ error: "cuec_id_must_be_uuid" }); return; }

  // Everything needed for provenance, in one org-scoped read.
  const cur = await pg.query<{
    document_id: string; vendor_id: string | null; vendor_name: string | null;
    original_filename: string | null; ordinal: number; cuec_text: string;
    review_status: string; review_status_reason: string | null;
    review_status_updated_by_user_id: string | null; review_status_updated_at: string | null;
    gap_basis: unknown; promoted_finding_id: string | null;
  }>(
    `SELECT c.document_id, d.vendor_id, v.name AS vendor_name, d.original_filename,
            c.ordinal, c.cuec_text, c.review_status, c.review_status_reason,
            c.review_status_updated_by_user_id, c.review_status_updated_at::text AS review_status_updated_at,
            c.gap_basis, c.promoted_finding_id
       FROM vendor_assurance_cuecs c
       JOIN vendor_assurance_documents d
         ON d.id = c.document_id AND d.organization_id = c.organization_id
       LEFT JOIN vendors v ON v.id = d.vendor_id AND v.organization_id = c.organization_id
      WHERE c.id = $1 AND c.organization_id = $2
      LIMIT 1`,
    [cuecId, organizationId]
  );
  if ((cur.rowCount ?? 0) === 0) { res.status(404).json({ error: "vendor_assurance_cuec_not_found" }); return; }
  const cuec = cur.rows[0]!;

  // Already promoted — return what exists. Idempotent by design.
  if (cuec.promoted_finding_id != null) {
    const existing = await pg.query(
      `SELECT id, title, severity, due_date, status, operational_status, decision_state
         FROM findings WHERE id = $1 AND organization_id = $2`,
      [cuec.promoted_finding_id, organizationId]
    );
    res.status(200).json({ finding: existing.rows[0] ?? null, created: false });
    return;
  }

  // ONLY A GAP JUSTIFIES A FINDING. A satisfied or not-applicable CUEC has
  // nothing to remediate, and a pending one has had no determination at all.
  if (cuec.review_status !== "gap") {
    res.status(409).json({
      error: "cuec_not_a_gap",
      detail:
        "Only a CUEC reviewed as a gap — applicable to this organisation and not " +
        "met by it — can become a finding. Record that determination first."
    });
    return;
  }

  const severity = validateVendorCuecSeverity(req.body);
  if ("error" in severity) { res.status(400).json(severity); return; }

  // The org's own policy sets the deadline. Same call site every other finding
  // uses; no vendor-specific SLA.
  const dueDate = await resolveSlaDueDate(organizationId, severity.value);

  const vendorLabel = cuec.vendor_name ?? "this vendor";
  const title = `CUEC not met: ${cuec.cuec_text.trim().slice(0, 160)}`;
  const description =
    `${vendorLabel} requires this of ${"your organisation"} as a Complementary User Entity Control, ` +
    `and a review on ${cuec.review_status_updated_at ?? "an earlier date"} determined that it is not met.\n\n` +
    `Vendor requirement (CUEC #${cuec.ordinal}), verbatim from the vendor's report:\n` +
    `"${cuec.cuec_text.trim()}"\n\n` +
    `Reviewer's determination: ${cuec.review_status_reason ?? "(no reason recorded)"}\n\n` +
    `Source document: ${cuec.original_filename ?? "(filename unavailable)"}`;

  const inserted = await pg.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, source_type, source_id, title, severity, description,
        recommendation, status, decision_state, operational_status, due_date,
        evidence_refs, owner_user_id)
     VALUES ($1, 'vendor_review', $2, $3, $4, $5, $6, 'open', 'needs_review', 'open', $7, '{}', $8)
     RETURNING id`,
    [
      organizationId,
      // source_id points at the VENDOR: the finding is about the organisation's
      // obligation arising from that relationship, and the vendor is the durable
      // object a reader navigates to. Document and CUEC provenance live in the
      // description and the audit event, which survive document deletion.
      cuec.vendor_id,
      title,
      severity.value,
      description,
      `Implement or evidence the control this vendor requires, or record a risk acceptance if the exposure is being carried deliberately.`,
      dueDate,
      req.userId ?? null
    ]
  );
  const findingId = inserted.rows[0]!.id;

  await pg.query(
    `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $3, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [cuecId, organizationId, findingId]
  );

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.cuec.promoted_to_finding",
    resourceType: "vendor_assurance_cuec",
    resourceId: cuecId,
    // The full provenance chain, in one immutable record: which vendor, which
    // document, which requirement, who determined it and when, and what it
    // produced. This is what an auditor reads.
    payload: {
      finding_id: findingId,
      vendor_id: cuec.vendor_id,
      vendor_name: cuec.vendor_name,
      document_id: cuec.document_id,
      source_document: cuec.original_filename,
      cuec_ordinal: cuec.ordinal,
      cuec_text: cuec.cuec_text,
      determination_reason: cuec.review_status_reason,
      determined_by_user_id: cuec.review_status_updated_by_user_id,
      determined_at: cuec.review_status_updated_at,
      gap_basis: cuec.gap_basis,
      severity: severity.value,
      due_date: dueDate
    },
    ipAddress: req.ip ?? null
  });

  logger.info(
    { event: "vendor_assurance_cuec_promoted", organizationId, cuecId, findingId,
      vendorId: cuec.vendor_id, severity: severity.value },
    "Vendor CUEC gap promoted to finding"
  );

  const created = await pg.query(
    `SELECT id, title, severity, due_date, status, operational_status, decision_state, source_type, source_id
       FROM findings WHERE id = $1 AND organization_id = $2`,
    [findingId, organizationId]
  );
  res.status(201).json({ finding: created.rows[0], created: true });
}

/** Severity for a promoted CUEC gap — the reviewer's call, from the canonical four. */
function validateVendorCuecSeverity(body: unknown): { value: string } | { error: string; detail?: string } {
  const raw = (body as Record<string, unknown> | null)?.["severity"];
  const allowed = ["Critical", "High", "Moderate", "Low"];
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    return {
      error: "invalid_severity",
      // Deliberately no default. A severity the platform picked would carry no
      // author, and severity drives the SLA — the deadline has to belong to a person.
      detail: `severity is required and must be one of: ${allowed.join(", ")}`
    };
  }
  return { value: raw };
}

/* =========================================================
   Export — reviewed-document download as .xlsx / .pdf.
   Allowed on any state where there is content to export
   (extracted, manual_review_requested, approved, rejected, finalized);
   refused with 409 on the in-flight / failed states. Each successful export
   fires a vendor_assurance.document.exported audit event with { format }.
   ========================================================= */
const EXPORT_BLOCKED_STATUSES = new Set(["pending", "extracting", "extraction_failed"]);

async function exportVendorAssuranceDocumentInternal(
  req: Request,
  res: Response,
  format: "xlsx" | "pdf"
): Promise<void> {
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

  // Existence (org-scoped → 404 cross-org) + exportability gate.
  //
  // A04-G1: explicit withTenant rather than an asTenant route wrap. This handler
  // STREAMS (setHeader + send of a rendered buffer) and asTenant's buffering
  // proxy throws on a handler that sets headers. Every DB read therefore opens
  // its own short scope and the render/stream happens outside it — which also
  // keeps the tenant connection off the multi-second workbook/PDF render.
  const gate = await withTenant(organizationId, () =>
    pg.query<{ processing_status: string }>(
      `SELECT processing_status FROM vendor_assurance_documents
        WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [documentId, organizationId]
    )
  );
  if ((gate.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }
  const status = gate.rows[0]!.processing_status;
  if (EXPORT_BLOCKED_STATUSES.has(status)) {
    res.status(409).json({ error: "vendor_assurance_document_not_exportable", status });
    return;
  }

  let bundle;
  try {
    bundle = await withTenant(organizationId, () =>
      buildExportBundle(documentId, organizationId, { exportedByUserId: req.userId ?? null })
    );
  } catch (err) {
    logger.error(
      { event: "vendor_assurance_export_bundle_failed", organizationId, documentId, format, err },
      "Vendor-assurance export bundle build failed"
    );
    res.status(500).json({ error: "export_failed" });
    return;
  }
  if (!bundle) {
    // Raced with a delete between the gate query and the bundle load.
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }

  let bytes: Buffer;
  let contentType: string;
  let filename: string;
  try {
    if (format === "xlsx") {
      bytes = await buildVendorAssuranceWorkbookBuffer(bundle);
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      filename = workbookDownloadFilename(bundle);
    } else {
      bytes = await buildVendorAssurancePdf(bundle);
      contentType = "application/pdf";
      filename = pdfDownloadFilename(bundle);
    }
  } catch (err) {
    logger.error(
      { event: "vendor_assurance_export_render_failed", organizationId, documentId, format, err },
      "Vendor-assurance export render failed"
    );
    if (!res.headersSent) res.status(500).json({ error: "export_failed" });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: req.userId ?? null,
    eventType: "vendor_assurance.document.exported",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: { format },
    ipAddress: req.ip ?? null
  });

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.status(200).send(bytes);
}

/** POST /api/vendor-assurance/documents/:id/export.xlsx */
export async function exportVendorAssuranceDocumentXlsx(req: Request, res: Response): Promise<void> {
  await exportVendorAssuranceDocumentInternal(req, res, "xlsx");
}

/** POST /api/vendor-assurance/documents/:id/export.pdf */
export async function exportVendorAssuranceDocumentPdf(req: Request, res: Response): Promise<void> {
  await exportVendorAssuranceDocumentInternal(req, res, "pdf");
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
  requireEntitlement("premium"),
  denyContributor(),
  upload.single("document"),
  multerErrorHandler,
  uploadVendorAssuranceDocument
);

router.get(
  "/vendor-assurance/documents",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(listVendorAssuranceDocuments)
);

router.get(
  "/vendor-assurance/documents/:id",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(getVendorAssuranceDocument)
);

router.get(
  "/vendor-assurance/documents/:id/extraction",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(getVendorAssuranceExtraction)
);

router.get(
  "/vendor-assurance/documents/:id/pdf",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  getVendorAssurancePdfRedirect
);

router.post(
  "/vendor-assurance/documents/:id/export.xlsx",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  exportVendorAssuranceDocumentXlsx
);

router.post(
  "/vendor-assurance/documents/:id/export.pdf",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  exportVendorAssuranceDocumentPdf
);

router.post(
  "/vendor-assurance/extractions/:id/review-decisions",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(recordVendorAssuranceReviewDecisions)
);

router.post(
  "/vendor-assurance/documents/:id/finalize",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(finalizeVendorAssuranceDocument)
);

router.post(
  "/vendor-assurance/documents/:id/field-overrides",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(recordVendorAssuranceFieldOverride)
);

router.post(
  "/vendor-assurance/documents/:id/approve",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(approveVendorAssuranceDocument)
);

router.post(
  "/vendor-assurance/documents/:id/request-manual-review",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(requestVendorAssuranceManualReview)
);

router.post(
  "/vendor-assurance/documents/:id/reject",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(rejectVendorAssuranceDocument)
);

// ---- CUEC matcher package routes ----

router.get(
  "/vendor-assurance/documents/:id/cuecs",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  getVendorAssuranceCuecs
);

router.post(
  "/vendor-assurance/documents/:id/rematch-cuecs",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  rematchVendorAssuranceCuecs
);

router.post(
  "/vendor-assurance/cuecs/:cuecId/mappings",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(createVendorAssuranceCuecMapping)
);

router.post(
  "/vendor-assurance/cuecs/:cuecId/review-status",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(updateVendorAssuranceCuecReviewStatus)
);

// VA-1. Same guard stack as every other Vendor Assurance write: the feature
// flag, an authenticated key, org context, premium entitlement, contributor
// seats denied, and asTenant() so the whole handler runs with the RLS GUC set.
// Promoting a gap is governance work, not queue work.
router.post(
  "/vendor-assurance/cuecs/:cuecId/promote-to-finding",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(promoteVendorAssuranceCuecToFinding)
);

router.patch(
  "/vendor-assurance/cuec-mappings/:mappingId",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(updateVendorAssuranceCuecMapping)
);

export default router;
