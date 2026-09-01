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
 *   GET    /api/vendor-assurance/documents/:id/assurance-opinion
 *   POST   /api/vendor-assurance/documents/:id/assurance-opinion
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
import { materializeTestedControlResolutions } from "../lib/vendorAssurance/testedControlResolution.js";
import { materializeTestedControlOutcomes } from "../lib/vendorAssurance/outcomeMaterializer.js";
import { loadSufficiencyCandidates } from "../lib/vendorAssurance/sufficiencyCandidates.js";
import {
  VETO_EVALUATOR_VERSION,
  SUFFICIENCY_DETERMINATIONS,
  SUFFICIENCY_INDETERMINATE_REASONS,
  isSufficiencyDetermination,
  isSufficiencyIndeterminateReason,
  determinationPrecondition,
  buildDeterminationBasis,
} from "../lib/vendorAssurance/sufficiencyVetoes.js";
import { MAX_REVIEWER_NOTE } from "../lib/vendorAssurance/testedControlOutcome.js";
import {
  suggestEffectiveness,
  validateAcceptEffectiveness,
  validateAcceptExceptionEffect,
  type AuditorAssertion
} from "../lib/vendorAssurance/testedControlOutcome.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor, requireCapability } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireHumanReviewer } from "../lib/humanReviewer.js";
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
  computeApprovalReviewPrecondition,
  testedControlKeysOf,
  ASSURANCE_BEARING_FIELD_NAMES,
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
import { scheduleVendorScoreRecompute } from "../lib/vendorRiskScoreRecompute.js";
import { buildVendorAssuranceWorkbookBuffer, workbookDownloadFilename } from "../lib/vendorAssuranceExcelExporter.js";
import { buildVendorAssurancePdf, pdfDownloadFilename } from "../lib/vendorAssurancePdfExporter.js";
// VA-S4-P2 (step 4b): the governed opinion-acceptance surface. The normalizer
// and the coverage gate are PURE and ADVISORY — nothing here lets a proposal
// write itself, and the gate is reported, never acted on.
import {
  proposeAssuranceOpinion,
  opinionCoverageGate,
  isAssuranceOpinion
} from "../lib/vendorAssurance/assuranceOpinion.js";
import {
  validateAcceptOpinionBody,
  buildOpinionAcceptanceBasis
} from "../lib/vendorAssurance/opinionAcceptance.js";

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
  // the id baked into the storage_key. If the R2 put fails, we mark the row
  // as extraction_failed:pdf_unparseable and return 500 — the caller should
  // re-upload.
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
    // Rewind: mark the row failed so the operator/UI can see the cause.
    await withTenant(organizationId, () =>
      pg.query(
        `UPDATE vendor_assurance_documents
            SET processing_status = 'extraction_failed',
                processing_error_code = 'pdf_unparseable',
                processing_error_detail = $3,
                updated_at = NOW()
          WHERE id = $1 AND organization_id = $2`,
        [documentId, organizationId, `blob put: ${(err as Error)?.message ?? "failed"}`.slice(0, 4000)]
      )
    );
    logger.error(
      { event: "vendor_assurance_blob_put_failed", organizationId, documentId, err },
      "Vendor-assurance PDF upload to R2 failed"
    );
    res.status(500).json({ error: "blob_put_failed" });
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
      current_control_decisions: {},
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
    element_key: string | null;
    decision: "accept" | "edit" | "reject";
    reviewed_value: unknown;
    reviewer_note: string | null;
    decided_by_user_id: string | null;
    decided_at: string;
    id: string;
  }>(
    // S4-4C-0: per (field, element). See the note on the write path.
    `SELECT DISTINCT ON (field_name, element_key)
            field_name, element_key, decision, reviewed_value, reviewer_note,
            decided_by_user_id, decided_at, id
       FROM vendor_assurance_review_decisions
      WHERE extraction_id = $1 AND organization_id = $2
      ORDER BY field_name, element_key, decided_at DESC, id DESC`,
    [extraction.id, organizationId]
  );

  const currentDecisions: Record<string, {
    decision: "accept" | "edit" | "reject";
    reviewed_value: unknown;
    reviewer_note: string | null;
    decided_by_user_id: string | null;
    decided_at: string;
  }> = {};
  /** S4-4C-0: element-grain decisions, keyed by tested-control identifier. */
  const currentControlDecisions: Record<string, unknown> = {};
  for (const row of decisionsResult.rows) {
    const entry = {
      decision: row.decision,
      reviewed_value: row.reviewed_value,
      reviewer_note: row.reviewer_note,
      decided_by_user_id: row.decided_by_user_id,
      decided_at: row.decided_at
    };
    // Nullish, not strict-null — see the note on the write path.
    if (row.element_key == null) currentDecisions[row.field_name] = entry;
    else currentControlDecisions[row.element_key] = entry;
  }

  res.status(200).json({
    extraction,
    spans: spansResult.rows,
    current_decisions: currentDecisions,
    current_control_decisions: currentControlDecisions,
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
    // S4-4C-0: an element decision snapshots the ORIGINAL extracted control BY
    // VALUE. Extractions are mutable through field overrides, so a governance
    // decision must stay explainable against what the reviewer actually saw —
    // the same discipline as assurance_opinion_basis and gap_basis.
    let controlsByKey: Map<string, unknown> | null = null;
    if (decisions.some((d) => d.element_key !== null)) {
      const ext = await client.query<{ fields: Record<string, { value?: unknown }> | null }>(
        `SELECT fields FROM vendor_assurance_extractions
          WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [extractionId, organizationId]
      );
      const raw = (ext.rows[0]?.fields ?? {})["controls"]?.value;
      controlsByKey = new Map<string, unknown>();
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          const id = entry && typeof entry === "object" ? (entry as Record<string, unknown>)["control_id"] : null;
          if (typeof id === "string" && id.trim().length > 0) controlsByKey.set(id.trim(), entry);
        }
      }
      for (const d of decisions) {
        if (d.element_key !== null && !controlsByKey.has(d.element_key)) {
          // Reviewing a control this extraction does not contain would record a
          // decision about nothing, and would satisfy the approval gate without
          // anyone having looked at a real tested control.
          await client.query("ROLLBACK");
          client.release();
          res.status(409).json({
            error: "tested_control_not_in_extraction",
            element_key: d.element_key,
            available: [...controlsByKey.keys()]
          });
          return;
        }
      }
    }

    for (const d of decisions) {
      const snapshot = d.element_key === null ? null : controlsByKey?.get(d.element_key) ?? null;
      const ins = await client.query<{ id: string }>(
        `INSERT INTO vendor_assurance_review_decisions
           (organization_id, extraction_id, field_name, decision,
            reviewed_value, reviewer_note, decided_by_user_id,
            element_key, element_snapshot)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
         RETURNING id`,
        [
          organizationId,
          extractionId,
          d.field_name,
          d.decision,
          d.reviewed_value === null ? null : JSON.stringify(d.reviewed_value),
          d.reviewer_note,
          req.userId ?? null,
          d.element_key,
          snapshot === null ? null : JSON.stringify(snapshot)
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
        decision: d.decision,
        // S4-4C-0: which tested control, when the decision is element-grained.
        ...(d.element_key === null ? {} : { element_key: d.element_key })
      },
      ipAddress: req.ip ?? null
    });
  }

  // Read back the recomputed current-decision-per-field projection.
  const projection = await pg.query<{
    field_name: string;
    element_key: string | null;
    decision: "accept" | "edit" | "reject";
    reviewed_value: unknown;
    reviewer_note: string | null;
    decided_by_user_id: string | null;
    decided_at: string;
  }>(
    // S4-4C-0: DISTINCT ON (field_name, element_key). A whole-field decision
    // (element_key NULL) and each element decision are separate current
    // decisions; collapsing them by field alone would hide element review.
    `SELECT DISTINCT ON (field_name, element_key)
            field_name, element_key, decision, reviewed_value, reviewer_note,
            decided_by_user_id, decided_at
       FROM vendor_assurance_review_decisions
      WHERE extraction_id = $1 AND organization_id = $2
      ORDER BY field_name, element_key, decided_at DESC, id DESC`,
    [extractionId, organizationId]
  );
  // S4-4C-0: the two grains are reported SEPARATELY. Keying one map by
  // field_name alone would let an element decision on `controls` overwrite the
  // whole-field `controls` entry, so a client could not see that both exist —
  // and the field map would appear to say something about the array that only
  // a single control was decided about.
  const currentDecisions: Record<string, unknown> = {};
  const currentControlDecisions: Record<string, unknown> = {};
  for (const row of projection.rows) {
    // Nullish, not strict-null: a projection that omits the column yields
    // `undefined`, and treating that as an element decision would file a
    // whole-field decision under the key `undefined`. Same trap the CUEC
    // promotion check documents.
    if (row.element_key == null) currentDecisions[row.field_name] = row;
    else currentControlDecisions[row.element_key] = row;
  }

  res.status(200).json({
    inserted_ids: insertedIds,
    current_control_decisions: currentControlDecisions,
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

/**
 * S4-4C-0. Is this document's governed review state sufficient for it to enter
 * the assurance-eligible `approved` state?
 *
 * Reads the current-decision projection at BOTH grains — per field and per
 * tested control — and compares them against what an assurance determination
 * actually consumes.
 *
 * A document with no extraction cannot be approved at all: there is nothing to
 * have reviewed, and approving it would create an assurance-eligible record
 * asserting something nobody has read.
 */
async function evaluateApprovalReviewGate(
  documentId: string,
  organizationId: string
): Promise<{ ok: true } | { ok: false; detail: Record<string, unknown> }> {
  const ext = await pg.query<{ id: string; fields: Record<string, { value?: unknown }> | null }>(
    `SELECT id, fields FROM vendor_assurance_extractions
      WHERE document_id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((ext.rowCount ?? 0) === 0) {
    return { ok: false, detail: { reason: "no_extraction", missing_field_names: [...ASSURANCE_BEARING_FIELD_NAMES] } };
  }
  const extractionId = ext.rows[0]!.id;
  const controlsValue = (ext.rows[0]!.fields ?? {})["controls"]?.value;
  const { keys, unidentified } = testedControlKeysOf(controlsValue);

  // An extracted control with no usable identifier cannot be reviewed, so it
  // must not be approvable either — otherwise the gate is satisfiable by
  // producing unidentifiable controls.
  if (unidentified > 0) {
    return {
      ok: false,
      detail: {
        reason: "unidentified_tested_controls",
        unidentified_tested_control_count: unidentified,
        message:
          "Some extracted controls carry no control identifier, so they cannot be " +
          "individually reviewed. Correct the extraction before approving."
      }
    };
  }

  const decisions = await pg.query<{ field_name: string; element_key: string | null; decision: "accept" | "edit" | "reject" }>(
    `SELECT DISTINCT ON (field_name, element_key) field_name, element_key, decision
       FROM vendor_assurance_review_decisions
      WHERE extraction_id = $1 AND organization_id = $2
      ORDER BY field_name, element_key, decided_at DESC, id DESC`,
    [extractionId, organizationId]
  );

  const fieldDecisions: Record<string, { decision: "accept" | "edit" | "reject" }> = {};
  const reviewedControlKeys: string[] = [];
  for (const row of decisions.rows) {
    // Nullish, not strict-null — a row without the column is a whole-field
    // decision, and mis-filing it would make the gate unsatisfiable.
    if (row.element_key == null) fieldDecisions[row.field_name] = { decision: row.decision };
    else if (row.field_name === "controls") reviewedControlKeys.push(row.element_key);
  }

  const precondition = computeApprovalReviewPrecondition({
    fieldDecisions,
    testedControlKeys: keys,
    reviewedTestedControlKeys: reviewedControlKeys,
  });
  if (precondition.ok) return { ok: true };
  return {
    ok: false,
    detail: {
      reason: "review_incomplete",
      missing_field_names: precondition.missing_field_names,
      unreviewed_control_keys: precondition.unreviewed_control_keys,
      message:
        "An assurance document cannot become the version of record until its " +
        "assurance-bearing fields and each tested control have been reviewed."
    }
  };
}

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

  // #947: AN APPROVAL MUST NAME THE PERSON WHO MADE IT.
  //
  // `req.userId` is populated on exactly ONE code path — the JWT-bridge branch
  // of requireApiKey.ts, i.e. a Bearer SESSION token. A raw API key sets
  // req.apiKey and leaves req.userId undefined. This route's guard stack does
  // not require a user session, so before this check an API-key-only
  // integration could produce an `approved` document — the version of record —
  // with `approved_by_user_id = null`, and the approved-consistency CHECK,
  // which says nothing about the approver, would allow it.
  //
  // Refused here, before any query, so an unattributed caller gets a clean 403
  // rather than the database trigger's 500. Scoped to the APPROVAL: reject and
  // request-manual-review are review actions that record no approver and are
  // deliberately unchanged.
  //
  // The product path is unaffected — the app's approveDocument server action
  // sends the signed-in user's session token
  // (app/src/app/actions/vendorAssurance.ts).
  const approverUserId = req.userId ?? null;
  if (opts.setApproved && !approverUserId) {
    res.status(403).json({
      error: "human_approver_required",
      detail:
        "Approving a document is a governance decision and must name the person " +
        "who made it. This request carries no authenticated user."
    });
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

  // S4-4C-0: THE APPROVAL AUTHORITY GATE.
  //
  // `approved` is the terminal assurance-eligible state and the one the S4
  // predicate keys on. The LEGACY `finalize` route required a current review
  // decision on every material field; `approve` replaced it and required none,
  // so the newer state asserted LESS than the one it replaced while S4 treated
  // it as authoritative. Measured before this change: zero review decisions
  // existed anywhere in the estate.
  //
  // The gate is NOT a verbatim restore of computeFinalizePrecondition — that
  // demanded review of fields the coverage chain never reads. It requires the
  // ASSURANCE-BEARING fields, plus a decision on each tested control
  // individually, because S4 reasons about each control separately.
  //
  // Reject and request-manual-review are untouched: neither claims assurance
  // eligibility, and gating them would block the very workflow a reviewer uses
  // to deal with a bad extraction.
  if (opts.setApproved) {
    const gate = await evaluateApprovalReviewGate(documentId, organizationId);
    if (!gate.ok) {
      res.status(409).json({
        error: "vendor_assurance_approval_review_incomplete",
        ...gate.detail
      });
      return;
    }
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
        // #947: the VERIFIED approver, never `req.userId ?? null`. The guard
        // above has already refused an unattributed caller, so this cannot be
        // null on the approval path.
        [documentId, organizationId, opts.targetStatus, approverUserId]
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
    // #947: the SAME actor the row was attributed to. On the approval path the
    // guard above guarantees a real user id, so the audit trail and
    // `approved_by_user_id` can never name different people — or nobody.
    actorUserId: approverUserId,
    eventType: opts.eventType,
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: opts.auditPayload,
    ipAddress: req.ip ?? null
  });

  // VA-S4-4C-2: approval is the moment the document becomes the version of
  // record, so it is the moment its tested controls are resolved against the
  // governed crosswalk. This is NOT S4 coverage wiring — it records vendor-side
  // canonical identity and mapping provenance, and asserts nothing about
  // applicability, sufficiency or effectiveness.
  //
  // Deliberately AFTER the transition and NON-BLOCKING. A resolution failure
  // must never un-approve or fail an approval a human already made and that the
  // database has already committed; the materializer is idempotent by
  // supersession, so a failed run is recoverable by re-running it. The failure
  // is logged loudly rather than swallowed, because a document approved with no
  // resolution record is a gap somebody has to see.
  if (opts.setApproved) {
    try {
      const outcome = await withTenant(organizationId, () =>
        materializeTestedControlResolutions(pg, { organizationId, documentId })
      );
      logger.info(
        { event: "vendor_tested_controls_resolved", organizationId, documentId, outcome },
        "Vendor tested-control resolution materialised"
      );

      // VA-S4-4C-3: Layer 1 (what the auditor asserted) and Layer 3 (the
      // exceptions and which controls they reach), materialised at the same
      // moment and under the same non-blocking discipline.
      //
      // LAYER 2 IS NOT MATERIALISED HERE OR ANYWHERE. Governed effectiveness is
      // a human determination with its own route; seeding it with any value
      // would mean the platform held an effectiveness nobody decided.
      const outcomes = await withTenant(organizationId, () =>
        materializeTestedControlOutcomes(pg, { organizationId, documentId })
      );
      logger.info(
        { event: "vendor_tested_control_outcomes_materialised", organizationId, documentId, outcomes },
        "Vendor tested-control assertions and exceptions materialised"
      );
    } catch (err) {
      logger.error(
        { event: "vendor_tested_control_resolution_failed", organizationId, documentId, err },
        "Vendor tested-control resolution failed — the document is approved but has NO resolution record"
      );
    }
  }

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
   VA-S4-P2 (wiring-plan step 4b) — the governed auditor-opinion ACCEPTANCE
   surface.

   GET  /api/vendor-assurance/documents/:id/assurance-opinion
   POST /api/vendor-assurance/documents/:id/assurance-opinion

   20261066 shipped the vocabulary, the coverage gate, the proposal normalizer
   and an authority CHECK making an opinion without a named acceptor
   structurally impossible — and then shipped NO WRITER. S4-P1 measured the
   consequence: `assurance_opinion` appeared in exactly two files, neither of
   which could set it, and no row has ever reached the opinion hop in any
   environment. This is the missing writer, and deliberately the only one.

   WHAT ACCEPTANCE DOES NOT DO — owner ruling, 2026-08-30. Accepting the
   report-level opinion MUST NOT itself establish requirement coverage, reduce
   questionnaire depth, change residual risk, override a control exception, or
   override contradictory evidence. It is ONE veto passed out of many (report /
   TSC scope, report period, Type I vs Type II, tested-control result,
   exceptions, carve-outs, contradictory evidence, open findings, mapping
   authority, human acceptance). So this handler computes no coverage, touches
   no scope, schedules no vendor-score recompute and creates no finding — and
   the row it writes says so in `establishes_requirement_coverage: false`.
   ========================================================= */

const OPINION_SELECT = `
  id,
  processing_status,
  approved_at,
  approved_by_user_id,
  assurance_opinion,
  assurance_opinion_note,
  assurance_opinion_reviewer_note,
  assurance_opinion_basis,
  assurance_opinion_accepted_by_user_id,
  assurance_opinion_accepted_at
`;

type OpinionDocRow = {
  id: string;
  processing_status: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
  assurance_opinion: string | null;
  assurance_opinion_note: string | null;
  assurance_opinion_reviewer_note: string | null;
  assurance_opinion_basis: unknown;
  assurance_opinion_accepted_by_user_id: string | null;
  assurance_opinion_accepted_at: string | null;
};

/**
 * Resolve the auditor-opinion text a reviewer is actually looking at: the
 * latest field override if one exists, else the extraction value. Same
 * precedence recordVendorAssuranceFieldOverride uses when it captures
 * original_value, and for the same reason — the governed decision must be made
 * against what is displayed, not against a value the reviewer already corrected.
 */
async function loadAuditorOpinionSourceText(
  documentId: string,
  organizationId: string
): Promise<{ text: string | null; origin: "extraction" | "field_override" | "absent"; extractionId: string | null }> {
  const priorOverride = await pg.query<{ override_value: unknown }>(
    `SELECT override_value FROM vendor_assurance_field_overrides
      WHERE document_id = $1 AND organization_id = $2 AND field_name = 'auditor_opinion'
      ORDER BY overridden_at DESC, id DESC
      LIMIT 1`,
    [documentId, organizationId]
  );
  if ((priorOverride.rowCount ?? 0) > 0) {
    const v = priorOverride.rows[0]!.override_value;
    return { text: typeof v === "string" ? v : v == null ? null : JSON.stringify(v), origin: "field_override", extractionId: null };
  }

  const extraction = await pg.query<{ id: string; fields: Record<string, { value?: unknown }> | null }>(
    `SELECT id, fields FROM vendor_assurance_extractions
      WHERE document_id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((extraction.rowCount ?? 0) === 0) {
    return { text: null, origin: "absent", extractionId: null };
  }
  const row = extraction.rows[0]!;
  const raw = (row.fields ?? {})["auditor_opinion"]?.value;
  return {
    text: typeof raw === "string" ? raw : raw == null ? null : JSON.stringify(raw),
    origin: "extraction",
    extractionId: row.id
  };
}

/* GET /api/vendor-assurance/documents/:id/assurance-opinion
 *
 * The reviewer's screen: what the report says, what the deterministic
 * normalizer proposes from those words, and what (if anything) has already been
 * accepted. The proposal is ADVISORY and is labelled `requires_human: true` at
 * its source — a caller that acts on it unattended has to ignore a field that
 * exists to be read.
 */
export async function getVendorAssuranceOpinion(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }

  const docResult = await pg.query<OpinionDocRow>(
    `SELECT ${OPINION_SELECT} FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((docResult.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }
  const doc = docResult.rows[0]!;

  const source = await loadAuditorOpinionSourceText(documentId, organizationId);
  const proposal = proposeAssuranceOpinion(source.text);

  res.status(200).json({
    document_id: documentId,
    accepted: doc.assurance_opinion === null
      ? null
      : {
          opinion: doc.assurance_opinion,
          source_text_at_acceptance: doc.assurance_opinion_note,
          reviewer_note: doc.assurance_opinion_reviewer_note,
          accepted_by_user_id: doc.assurance_opinion_accepted_by_user_id,
          accepted_at: doc.assurance_opinion_accepted_at,
          basis: doc.assurance_opinion_basis
        },
    source: { origin: source.origin, extraction_id: source.extractionId, auditor_opinion_text: source.text },
    proposal,
    // Advisory. Reported so a reviewer can see what the coarse gate would read,
    // never so a caller can treat it as coverage.
    coverage_gate: opinionCoverageGate(
      isAssuranceOpinion(doc.assurance_opinion) ? doc.assurance_opinion : null
    ),
    establishes_requirement_coverage: false,
    acceptable: {
      // Why the POST would refuse right now, computed once so the client does
      // not have to reimplement the guard order.
      document_approved: doc.processing_status === "approved",
      approval_attributed: doc.approved_by_user_id !== null,
      already_accepted: doc.assurance_opinion !== null
    }
  });
}

/* POST /api/vendor-assurance/documents/:id/assurance-opinion
 *   { opinion, reviewer_note?, supersede? }
 *
 * A REAL AUTHENTICATED HUMAN accepts. The route's guard stack is
 * requireApiKey-based and does NOT require a user session, so `req.userId` can
 * legitimately be null for a machine integration. The 20261066 authority CHECK
 * would turn that into a 500; more importantly, an unattributed governance
 * decision is not a governance decision. It is refused with a clean 403 before
 * any write is attempted.
 *
 * THE DOCUMENT MUST BE THE VERSION OF RECORD. Owner ruling 1's canonical chain
 * begins at an APPROVED assurance document, so an opinion cannot be accepted
 * against one still in review, rejected, or legacy-finalized. And approval
 * itself must be attributed: the approve route writes
 * `approved_by_user_id = req.userId ?? null`, and its consistency CHECK does not
 * mention the approver, so an API-key-only integration can produce an approved
 * document with a NULL approver. Such a document cannot carry a governed
 * opinion — refused, rather than silently accepted and later filtered out.
 *
 * RE-DECISION IS EXPLICIT. An already-accepted opinion returns 409 unless the
 * caller passes `supersede: true` AND states why. Precedent:
 * updateVendorAssuranceCuecReviewStatus refuses to re-decide underneath
 * downstream work rather than silently overwriting a governed determination.
 */
export async function acceptVendorAssuranceOpinion(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }

  // Fail closed on an unattributed caller BEFORE anything else. This is a
  // property of the caller, not of the document, so it is checked without
  // touching the database.
  const acceptorUserId = req.userId ?? null;
  if (!acceptorUserId) {
    res.status(403).json({
      error: "human_acceptor_required",
      detail:
        "Accepting an assurance opinion is a governance decision and must name " +
        "the person who made it. This request carries no authenticated user."
    });
    return;
  }

  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }

  const docResult = await pg.query<OpinionDocRow>(
    `SELECT ${OPINION_SELECT} FROM vendor_assurance_documents
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [documentId, organizationId]
  );
  if ((docResult.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "vendor_assurance_document_not_found" });
    return;
  }
  const doc = docResult.rows[0]!;

  if (doc.processing_status !== "approved") {
    res.status(409).json({
      error: "vendor_assurance_document_not_approved",
      status: doc.processing_status,
      detail:
        "An assurance opinion is accepted against the version of record. " +
        "Approve the document first."
    });
    return;
  }
  if (doc.approved_by_user_id === null) {
    res.status(409).json({
      error: "vendor_assurance_document_approval_unattributed",
      detail:
        "This document was approved with no named approver, so it cannot carry " +
        "a governed opinion. Re-approve it as an authenticated user."
    });
    return;
  }

  const source = await loadAuditorOpinionSourceText(documentId, organizationId);
  const proposal = proposeAssuranceOpinion(source.text);

  const validated = validateAcceptOpinionBody(req.body, proposal.candidate);
  if ("error" in validated) { res.status(400).json(validated); return; }
  const { opinion, reviewer_note, supersede } = validated.input;

  const priorOpinion = doc.assurance_opinion;
  if (priorOpinion !== null && !supersede) {
    res.status(409).json({
      error: "assurance_opinion_already_accepted",
      accepted: {
        opinion: priorOpinion,
        accepted_by_user_id: doc.assurance_opinion_accepted_by_user_id,
        accepted_at: doc.assurance_opinion_accepted_at
      },
      detail:
        "A governed opinion already stands on this document. Re-deciding it is " +
        "an explicit act: resend with supersede: true and a reviewer_note saying " +
        "what changed."
    });
    return;
  }

  const acceptedAt = new Date().toISOString();
  const basis = buildOpinionAcceptanceBasis({
    acceptedAt,
    acceptedByUserId: acceptorUserId,
    accepted: opinion,
    proposal,
    sourceText: source.text,
    sourceOrigin: source.origin,
    extractionId: source.extractionId,
    documentStatus: doc.processing_status,
    documentApprovedAt: doc.approved_at,
    documentApprovedByUserId: doc.approved_by_user_id,
    reviewerNote: reviewer_note,
    priorAcceptance: priorOpinion === null
      ? null
      : {
          opinion: priorOpinion,
          accepted_by_user_id: doc.assurance_opinion_accepted_by_user_id,
          accepted_at: doc.assurance_opinion_accepted_at,
          reviewer_note: doc.assurance_opinion_reviewer_note
        }
  });

  // The preconditions are RE-ASSERTED in the UPDATE, so a concurrent approve
  // reversal or a second acceptance loses the race cleanly instead of both
  // writing. `IS NOT DISTINCT FROM` covers the NULL prior case without a second
  // statement.
  const upd = await pg.query<OpinionDocRow>(
    `UPDATE vendor_assurance_documents
        SET assurance_opinion = $3,
            assurance_opinion_note = $4,
            assurance_opinion_reviewer_note = $5,
            assurance_opinion_basis = $6::jsonb,
            assurance_opinion_accepted_by_user_id = $7,
            assurance_opinion_accepted_at = NOW(),
            updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
        AND processing_status = 'approved'
        AND approved_by_user_id IS NOT NULL
        AND assurance_opinion IS NOT DISTINCT FROM $8
      RETURNING ${OPINION_SELECT}`,
    [
      documentId,
      organizationId,
      opinion,
      // The report's own words AS AT ACCEPTANCE. Extractions are mutable; this
      // snapshot is what lets the normalised value be argued back to the report.
      source.text,
      reviewer_note,
      JSON.stringify(basis),
      acceptorUserId,
      priorOpinion
    ]
  );
  if ((upd.rowCount ?? 0) === 0) {
    res.status(409).json({
      error: "assurance_opinion_acceptance_conflict",
      detail:
        "The document changed while this acceptance was being prepared. " +
        "Re-read the opinion and decide again."
    });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: acceptorUserId,
    eventType: priorOpinion === null
      ? "vendor_assurance.opinion.accepted"
      : "vendor_assurance.opinion.superseded",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: {
      opinion,
      proposed_candidate: proposal.candidate,
      human_agreed_with_candidate: opinion === proposal.candidate,
      normalizer_version: proposal.normalizer_version,
      ...(reviewer_note ? { reviewer_note } : {}),
      ...(priorOpinion === null ? {} : { superseded_opinion: priorOpinion }),
      // Stated in the audit trail too: this event is not a coverage decision.
      establishes_requirement_coverage: false
    },
    ipAddress: req.ip ?? null
  });

  const row = upd.rows[0]!;
  res.status(200).json({
    document_id: documentId,
    accepted: {
      opinion: row.assurance_opinion,
      source_text_at_acceptance: row.assurance_opinion_note,
      reviewer_note: row.assurance_opinion_reviewer_note,
      accepted_by_user_id: row.assurance_opinion_accepted_by_user_id,
      accepted_at: row.assurance_opinion_accepted_at,
      basis: row.assurance_opinion_basis
    },
    proposal,
    coverage_gate: opinionCoverageGate(opinion),
    // Owner ruling, restated on every response: one veto passed is not coverage.
    establishes_requirement_coverage: false
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

  // THE VENDOR'S RISK SCORE MUST MOVE WHEN A GAP IS RECORDED AGAINST IT.
  // Promotion was the one vendor-finding-creating path that scheduled no
  // recompute at all — the third, independent reason a promoted CUEC never
  // reached vendor risk, after the resolver and the scoring query. Without this
  // the score only corrects itself the next time some UNRELATED finding on the
  // same vendor changes state, which is indistinguishable from "the gap does not
  // count". The known-vendor variant is used because the vendor id is already in
  // hand; fire-and-forget and best-effort by contract, so a score refresh
  // failure can never fail the promotion.
  if (cuec.vendor_id != null) {
    scheduleVendorScoreRecompute(organizationId, cuec.vendor_id);
  }

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

/* =========================================================
   VA-S4-4C-3 — the three-layer assurance outcome surface.

   LAYER 1 (auditor assertion) is machine-produced and read-only here.
   LAYER 2 (governed effectiveness) and LAYER 3 (exception effect) are HUMAN
   determinations, and each is a DISTINCT authority action with its own audit
   event. Owner ruling: the same person may hold authority for tested-control
   review, effectiveness acceptance and document approval, but performing one
   must never implicitly perform another. Nothing in these handlers approves a
   document, records a review decision, or establishes requirement coverage.
   ========================================================= */


type OutcomeDocRow = {
  id: string;
  processing_status: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  assurance_opinion: string | null;
  extraction_id: string | null;
};

const OUTCOME_DOC_SQL = `
  SELECT d.id, d.processing_status, d.approved_by_user_id, d.approved_at,
         d.assurance_opinion, e.id AS extraction_id
    FROM vendor_assurance_documents d
    LEFT JOIN vendor_assurance_extractions e ON e.document_id = d.id
   WHERE d.id = $1 AND d.organization_id = $2
   LIMIT 1`;

async function loadOutcomeDoc(documentId: string, organizationId: string): Promise<OutcomeDocRow | null> {
  const r = await pg.query<OutcomeDocRow>(OUTCOME_DOC_SQL, [documentId, organizationId]);
  return r.rows[0] ?? null;
}

/* GET /api/vendor-assurance/documents/:id/assurance-outcomes
 *
 * The reviewer's screen, and the read model for all three layers at once.
 *
 * The three are returned SEPARATELY and are never merged into a single verdict
 * field. That is the whole point of the shape: a caller that wants "is this
 * control fine" has to look at what the auditor said, what SecureLogic
 * determined, and what exceptions stand — because those are three different
 * questions and the answers legitimately differ.
 */
export async function getVendorAssuranceOutcomes(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }

  const doc = await loadOutcomeDoc(documentId, organizationId);
  if (doc === null) { res.status(404).json({ error: "vendor_assurance_document_not_found" }); return; }

  const assertions = doc.extraction_id === null ? { rows: [] } : await pg.query(
    `SELECT element_key, auditor_assertion, source_text, source_term, effective_source,
            override_id, normalizer_version, normalizer_rule, normalizer_reason, asserted_at
       FROM vendor_tested_control_assertions
      WHERE extraction_id = $1 AND organization_id = $2 AND superseded_at IS NULL
      ORDER BY element_key`,
    [doc.extraction_id, organizationId]
  );

  const effectiveness = doc.extraction_id === null ? { rows: [] } : await pg.query(
    `SELECT f.element_key, f.decision, f.governed_effectiveness, f.indeterminate_reason,
            f.reviewer_note, f.accepted_by_user_id, f.accepted_at, f.basis,
            u.name AS accepted_by_name
       FROM vendor_tested_control_effectiveness f
       LEFT JOIN users u ON u.id = f.accepted_by_user_id
      WHERE f.extraction_id = $1 AND f.organization_id = $2 AND f.superseded_at IS NULL
      ORDER BY f.element_key`,
    [doc.extraction_id, organizationId]
  );

  const exceptions = doc.extraction_id === null ? { rows: [] } : await pg.query(
    `SELECT e.id, e.exception_ref, e.source_ordinal, e.description, e.auditor_assessment,
            e.source_term, e.governed_effect, e.effect_reviewer_note,
            e.effect_accepted_by_user_id, e.effect_accepted_at,
            u.name AS effect_accepted_by_name,
            COALESCE(
              json_agg(json_build_object(
                'element_key',  l.element_key,
                'link_source',  l.link_source,
                'source_value', l.source_value
              ) ORDER BY l.element_key) FILTER (WHERE l.id IS NOT NULL),
              '[]'::json
            ) AS controls
       FROM vendor_assurance_exceptions e
       LEFT JOIN vendor_assurance_exception_controls l ON l.exception_id = e.id
       LEFT JOIN users u ON u.id = e.effect_accepted_by_user_id
      WHERE e.extraction_id = $1 AND e.organization_id = $2 AND e.superseded_at IS NULL
      GROUP BY e.id, u.name
      ORDER BY e.source_ordinal`,
    [doc.extraction_id, organizationId]
  );

  const effectivenessByKey = new Map(effectiveness.rows.map((r: any) => [r.element_key, r]));
  const exceptionKeys = new Set<string>();
  for (const e of exceptions.rows as any[]) {
    for (const c of e.controls as Array<{ element_key: string }>) exceptionKeys.add(c.element_key);
  }

  res.status(200).json({
    document_id: documentId,
    document_status: doc.processing_status,

    // LAYER 1. What the source asserted.
    auditor_assertions: (assertions.rows as any[]).map((a) => ({
      element_key: a.element_key,
      assertion: a.auditor_assertion,
      source_text: a.source_text,
      source_term: a.source_term,
      effective_source: a.effective_source,
      override_id: a.override_id,
      normalizer: {
        version: a.normalizer_version,
        rule: a.normalizer_rule,
        reason: a.normalizer_reason
      },
      asserted_at: a.asserted_at,
      // Restated on every row, because this is the field a caller in a hurry
      // will misread as an outcome.
      establishes_governed_effectiveness: false,
      // The advisory bridge, computed fresh and labelled requires_human at its
      // source. Never persisted as a determination.
      suggested_effectiveness: suggestEffectiveness(a.auditor_assertion),
      // Present so the two layers are visibly independent on the same row: a
      // control may be EFFECTIVE and still carry an exception.
      has_exception: exceptionKeys.has(a.element_key),
      governed_effectiveness:
        effectivenessByKey.get(a.element_key)?.governed_effectiveness ?? null
    })),

    // LAYER 2. What SecureLogic governs.
    governed_effectiveness: (effectiveness.rows as any[]).map((f) => ({
      element_key: f.element_key,
      decision: f.decision,
      effectiveness: f.governed_effectiveness,
      indeterminate_reason: f.indeterminate_reason,
      reviewer_note: f.reviewer_note,
      accepted_by_user_id: f.accepted_by_user_id,
      accepted_by_name: f.accepted_by_name,
      accepted_at: f.accepted_at,
      basis: f.basis
    })),

    // LAYER 3. What the exceptions mean.
    exceptions: (exceptions.rows as any[]).map((e) => ({
      id: e.id,
      exception_ref: e.exception_ref,
      source_ordinal: e.source_ordinal,
      description: e.description,
      auditor_assessment: e.auditor_assessment,
      // TERMINOLOGY, not severity. Restated at the API boundary because this is
      // where a consumer is most likely to sort by it.
      source_term: e.source_term,
      source_term_carries_no_severity: true,
      governed_effect: e.governed_effect,
      effect_reviewer_note: e.effect_reviewer_note,
      effect_accepted_by_user_id: e.effect_accepted_by_user_id,
      effect_accepted_by_name: e.effect_accepted_by_name,
      effect_accepted_at: e.effect_accepted_at,
      controls: e.controls
    })),

    // Reported because it is a live gap, not because anything consumes it: a
    // control with an assertion and no governed effectiveness is NOT effective,
    // it is undetermined.
    unresolved: {
      controls_without_governed_effectiveness: (assertions.rows as any[])
        .map((a) => a.element_key)
        .filter((k) => !effectivenessByKey.has(k)),
      exceptions_without_governed_effect: (exceptions.rows as any[])
        .filter((e) => e.governed_effect === null)
        .map((e) => e.id)
    },

    // Owner ruling, restated on every response: none of this is coverage.
    establishes_requirement_coverage: false
  });
}

/* POST /api/vendor-assurance/documents/:id/tested-controls/:elementKey/effectiveness
 *   { decision?: "accepted"|"rejected", effectiveness?, indeterminate_reason?, reviewer_note?, supersede? }
 *
 * LAYER 2. A named human accepts, edits or rejects the governed effectiveness of
 * ONE tested control.
 *
 * WHAT THIS DOES NOT DO, and each of these is a test in the suite:
 *   - it does not touch any Layer-3 exception, so accepting EFFECTIVE cannot
 *     erase, hide, or downgrade an exception that stands against the control;
 *   - it does not read the document-level `assurance_opinion`, so a clean
 *     report-level opinion cannot overwrite control-level state;
 *   - it does not record a tested-control review decision (20261072) and it does
 *     not approve anything. Distinct authority actions, distinct audit events.
 */
export async function acceptTestedControlEffectiveness(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }

  const reviewerUserId = requireHumanReviewer(req, res, "Determining governed control effectiveness");
  if (!reviewerUserId) return;

  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }
  const elementKey = String(req.params["elementKey"] ?? "").trim();
  if (elementKey.length === 0) { res.status(400).json({ error: "element_key_required" }); return; }

  const doc = await loadOutcomeDoc(documentId, organizationId);
  if (doc === null) { res.status(404).json({ error: "vendor_assurance_document_not_found" }); return; }

  // The document must be the version of record, and its approval must itself be
  // attributed — the same two preconditions the opinion surface enforces, for
  // the same reason: a governed determination cannot rest on a document nobody
  // approved.
  if (doc.processing_status !== "approved") {
    res.status(409).json({
      error: "vendor_assurance_document_not_approved",
      status: doc.processing_status,
      detail: "Governed effectiveness is determined against the version of record. Approve the document first."
    });
    return;
  }
  if (doc.approved_by_user_id === null) {
    res.status(409).json({
      error: "vendor_assurance_document_approval_unattributed",
      detail: "This document was approved with no named approver, so it cannot carry a governed determination."
    });
    return;
  }
  if (doc.extraction_id === null) {
    res.status(409).json({ error: "vendor_assurance_extraction_missing" });
    return;
  }

  // The Layer-1 assertion is the evidence this decision is made against. Its
  // absence is a refusal rather than a blank basis: deciding effectiveness for a
  // control the document does not test is not a determination, it is a typo.
  const assertionRes = await pg.query<{
    auditor_assertion: string; source_text: string | null; source_term: string | null;
    normalizer_version: string; normalizer_rule: string; normalizer_reason: string;
    effective_source: string;
  }>(
    `SELECT auditor_assertion, source_text, source_term, normalizer_version,
            normalizer_rule, normalizer_reason, effective_source
       FROM vendor_tested_control_assertions
      WHERE extraction_id = $1 AND organization_id = $2 AND element_key = $3
        AND superseded_at IS NULL
      LIMIT 1`,
    [doc.extraction_id, organizationId, elementKey]
  );
  const assertion = assertionRes.rows[0];
  if (assertion === undefined) {
    res.status(404).json({
      error: "tested_control_assertion_not_found",
      detail: "This document records no tested control with that identifier."
    });
    return;
  }

  const suggestion = suggestEffectiveness(assertion.auditor_assertion as AuditorAssertion);
  const validated = validateAcceptEffectiveness(req.body, suggestion);
  if ("error" in validated) { res.status(400).json(validated); return; }
  const { decision, effectiveness, indeterminate_reason, reviewer_note, supersede } = validated.input;

  const priorRes = await pg.query<{
    id: string; decision: string; governed_effectiveness: string | null;
    indeterminate_reason: string | null; accepted_by_user_id: string | null; accepted_at: string;
  }>(
    `SELECT id, decision, governed_effectiveness, indeterminate_reason, accepted_by_user_id, accepted_at
       FROM vendor_tested_control_effectiveness
      WHERE extraction_id = $1 AND organization_id = $2 AND element_key = $3
        AND superseded_at IS NULL
      LIMIT 1`,
    [doc.extraction_id, organizationId, elementKey]
  );
  const prior = priorRes.rows[0] ?? null;

  if (prior !== null && !supersede) {
    res.status(409).json({
      error: "governed_effectiveness_already_decided",
      standing: {
        decision: prior.decision,
        effectiveness: prior.governed_effectiveness,
        indeterminate_reason: prior.indeterminate_reason,
        accepted_by_user_id: prior.accepted_by_user_id,
        accepted_at: prior.accepted_at
      },
      detail:
        "A governed determination already stands for this control. Re-deciding it is an " +
        "explicit act: resend with supersede: true and a reviewer_note saying what changed."
    });
    return;
  }

  const decidedAt = new Date().toISOString();
  const basis = {
    decided_at: decidedAt,
    decided_by_user_id: reviewerUserId,
    element_key: elementKey,
    // The Layer-1 reading AS AT the decision. Assertions are re-materialized on
    // re-approval; the determination must stay explainable against what the
    // reviewer actually saw.
    layer1: {
      auditor_assertion: assertion.auditor_assertion,
      source_text: assertion.source_text,
      source_term: assertion.source_term,
      effective_source: assertion.effective_source,
      normalizer_version: assertion.normalizer_version,
      normalizer_rule: assertion.normalizer_rule,
      normalizer_reason: assertion.normalizer_reason
    },
    suggestion,
    human_agreed_with_suggestion:
      suggestion.candidate !== null && suggestion.candidate === effectiveness,
    decision,
    governed_effectiveness: effectiveness,
    indeterminate_reason,
    reviewer_note,
    document: {
      status: doc.processing_status,
      approved_at: doc.approved_at,
      approved_by_user_id: doc.approved_by_user_id
    },
    superseded_prior: prior === null ? null : {
      decision: prior.decision,
      effectiveness: prior.governed_effectiveness,
      indeterminate_reason: prior.indeterminate_reason,
      accepted_by_user_id: prior.accepted_by_user_id,
      accepted_at: prior.accepted_at
    },
    establishes_requirement_coverage: false
  };

  // The route is asTenant-wrapped, so the whole handler is ALREADY one
  // transaction on the tenant client with `app.current_org_id` set. Supersede
  // and insert are therefore atomic without opening anything: a nested
  // withTenant here would check out a SECOND pool connection with a SECOND
  // transaction that cannot see this one's writes.
  let inserted: Record<string, unknown> | null = null;
  if (prior !== null) {
    // The precondition is RE-ASSERTED in the UPDATE, so two concurrent
    // supersessions cannot both win — the loser writes nothing and 409s.
    const sup = await pg.query(
      `UPDATE vendor_tested_control_effectiveness
          SET superseded_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND superseded_at IS NULL`,
      [prior.id, organizationId]
    );
    if ((sup.rowCount ?? 0) === 0) {
      res.status(409).json({
        error: "governed_effectiveness_conflict",
        detail:
          "The determination changed while this decision was being prepared. " +
          "Re-read it and decide again."
      });
      return;
    }
  }
  const ins = await pg.query(
    `INSERT INTO vendor_tested_control_effectiveness
       (organization_id, document_id, extraction_id, element_key, decision,
        governed_effectiveness, indeterminate_reason, accepted_by_user_id,
        reviewer_note, basis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING id, decision, governed_effectiveness, indeterminate_reason,
               accepted_by_user_id, accepted_at, reviewer_note, basis`,
    [
      organizationId, documentId, doc.extraction_id, elementKey, decision,
      effectiveness, indeterminate_reason, reviewerUserId, reviewer_note,
      JSON.stringify(basis)
    ]
  );
  inserted = ins.rows[0] ?? null;

  if (inserted === null) {
    res.status(409).json({
      error: "governed_effectiveness_conflict",
      detail: "The determination changed while this decision was being prepared. Re-read it and decide again."
    });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: reviewerUserId,
    // A DISTINCT event type from tested-control review and from document
    // approval. One action, one event; none of the three implies another.
    eventType: prior === null
      ? "vendor_assurance.control_effectiveness.decided"
      : "vendor_assurance.control_effectiveness.superseded",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: {
      element_key: elementKey,
      decision,
      governed_effectiveness: effectiveness,
      indeterminate_reason,
      auditor_assertion: assertion.auditor_assertion,
      suggested_effectiveness: suggestion.candidate,
      human_agreed_with_suggestion: basis.human_agreed_with_suggestion,
      normalizer_version: suggestion.normalizer_version,
      ...(reviewer_note ? { reviewer_note } : {}),
      ...(prior === null ? {} : { superseded_effectiveness: prior.governed_effectiveness }),
      establishes_requirement_coverage: false
    },
    ipAddress: req.ip ?? null
  });

  res.status(200).json({
    document_id: documentId,
    element_key: elementKey,
    decided: inserted,
    suggestion,
    establishes_requirement_coverage: false
  });
}

/* POST /api/vendor-assurance/exceptions/:exceptionId/effect
 *   { governed_effect, reviewer_note?, supersede? }
 *
 * LAYER 3. A named human states what an exception ACTUALLY MEANS.
 *
 * The vocabulary is two values and neither is a severity. In particular a
 * `scope_limitation` is NOT a lesser `control_deficiency`: it says assurance was
 * not obtainable, which is a different claim from the control having failed, and
 * nothing here ranks one against the other.
 *
 * The auditor's own word ("exception" / "deviation") is never an input to this
 * decision and is never consulted by it. It is preserved untouched on the row.
 */
export async function acceptExceptionEffect(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }

  const reviewerUserId = requireHumanReviewer(req, res, "Interpreting an assurance exception");
  if (!reviewerUserId) return;

  const exceptionId = String(req.params["exceptionId"] ?? "").trim();
  if (!isUuid(exceptionId)) { res.status(400).json({ error: "exception_id_must_be_uuid" }); return; }

  const validated = validateAcceptExceptionEffect(req.body);
  if ("error" in validated) { res.status(400).json(validated); return; }
  const { governed_effect, reviewer_note, supersede } = validated.input;

  const exRes = await pg.query<{
    id: string; document_id: string; exception_ref: string | null; source_ordinal: number;
    description: string; auditor_assessment: string | null; source_term: string | null;
    governed_effect: string | null; effect_accepted_by_user_id: string | null;
    effect_accepted_at: string | null;
  }>(
    `SELECT id, document_id, exception_ref, source_ordinal, description, auditor_assessment,
            source_term, governed_effect, effect_accepted_by_user_id, effect_accepted_at
       FROM vendor_assurance_exceptions
      WHERE id = $1 AND organization_id = $2 AND superseded_at IS NULL
      LIMIT 1`,
    [exceptionId, organizationId]
  );
  const ex = exRes.rows[0];
  if (ex === undefined) { res.status(404).json({ error: "vendor_assurance_exception_not_found" }); return; }

  if (ex.governed_effect !== null && !supersede) {
    res.status(409).json({
      error: "exception_effect_already_decided",
      standing: {
        governed_effect: ex.governed_effect,
        accepted_by_user_id: ex.effect_accepted_by_user_id,
        accepted_at: ex.effect_accepted_at
      },
      detail:
        "A governed effect already stands on this exception. Re-deciding it is an explicit " +
        "act: resend with supersede: true and a reviewer_note saying what changed."
    });
    return;
  }

  const decidedAt = new Date().toISOString();
  const basis = {
    decided_at: decidedAt,
    decided_by_user_id: reviewerUserId,
    governed_effect,
    reviewer_note,
    source: {
      exception_ref: ex.exception_ref,
      source_ordinal: ex.source_ordinal,
      description: ex.description,
      auditor_assessment: ex.auditor_assessment,
      // Recorded so a later reader can confirm the effect was NOT derived from
      // the auditor's choice of word.
      source_term: ex.source_term,
      source_term_carries_no_severity: true
    },
    superseded_prior: ex.governed_effect === null ? null : {
      governed_effect: ex.governed_effect,
      accepted_by_user_id: ex.effect_accepted_by_user_id,
      accepted_at: ex.effect_accepted_at
    }
  };

  // asTenant already holds the transaction and the tenant GUC; `pg.query` routes
  // to that client. The prior effect is re-asserted in the WHERE clause so a
  // concurrent decision loses cleanly rather than both writing.
  const upd = await pg.query(
    `UPDATE vendor_assurance_exceptions
        SET governed_effect = $3,
            effect_reviewer_note = $4,
            effect_accepted_by_user_id = $5,
            effect_accepted_at = NOW(),
            effect_basis = $6::jsonb
      WHERE id = $1 AND organization_id = $2
        AND superseded_at IS NULL
        AND governed_effect IS NOT DISTINCT FROM $7
      RETURNING id, governed_effect, effect_reviewer_note, effect_accepted_by_user_id,
                effect_accepted_at, effect_basis`,
    [exceptionId, organizationId, governed_effect, reviewer_note, reviewerUserId,
     JSON.stringify(basis), ex.governed_effect]
  );
  if ((upd.rowCount ?? 0) === 0) {
    res.status(409).json({
      error: "exception_effect_conflict",
      detail: "The exception changed while this decision was being prepared. Re-read it and decide again."
    });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: reviewerUserId,
    eventType: ex.governed_effect === null
      ? "vendor_assurance.exception_effect.decided"
      : "vendor_assurance.exception_effect.superseded",
    resourceType: "vendor_assurance_document",
    resourceId: ex.document_id,
    payload: {
      exception_id: exceptionId,
      exception_ref: ex.exception_ref,
      governed_effect,
      source_term: ex.source_term,
      source_term_carries_no_severity: true,
      ...(reviewer_note ? { reviewer_note } : {}),
      ...(ex.governed_effect === null ? {} : { superseded_effect: ex.governed_effect }),
      establishes_requirement_coverage: false
    },
    ipAddress: req.ip ?? null
  });

  res.status(200).json({
    exception_id: exceptionId,
    decided: upd.rows[0],
    establishes_requirement_coverage: false
  });
}

/* ===========================================================================
 * VA-S4-4C-4 - the governed sufficiency determination
 * =========================================================================*/

/* GET /api/vendor-assurance/documents/:id/sufficiency-candidates
 *
 * Every (organisation requirement x tested control) candidate this document
 * produces, each with its twelve-veto evaluation and any determination already
 * recorded against it.
 *
 * THE FAN-OUT IS RETURNED, NOT COLLAPSED. Ruling 6: one tested control mapping
 * to eight requirements is eight candidates to be judged separately, never one
 * conclusion. A caller that wants a count of covered requirements will not find
 * one here, because this surface establishes no coverage at all.
 */
export async function getSufficiencyCandidates(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }

  const doc = await loadOutcomeDoc(documentId, organizationId);
  if (doc === null) { res.status(404).json({ error: "vendor_assurance_document_not_found" }); return; }

  const candidates = doc.extraction_id === null ? [] : await loadSufficiencyCandidates(pg, {
    organizationId,
    documentId,
    extractionId: doc.extraction_id,
    acceptedOpinion: doc.assurance_opinion ?? null
  });

  res.status(200).json({
    document_id: documentId,
    evaluator_version: VETO_EVALUATOR_VERSION,
    candidates,
    // Restated on every response, as 4C-3's are. The whole surface is a
    // determination ABOUT assurance, never an assertion OF coverage.
    establishes_requirement_coverage: false
  });
}

/* POST /api/vendor-assurance/documents/:id/candidates/:resolutionId/sufficiency
 *
 * Body: { requirement_framework_key, requirement_framework_version,
 *         requirement_reference, determination, indeterminate_reason?,
 *         reviewer_note?, supersede? }
 *
 * A named human records whether this assurance supports this requirement.
 *
 * SUFFICIENT HARD-REFUSES while any evaluated veto is FIRED or NOT_EVALUABLE,
 * per the owner ruling of 2026-08-31. There is no override parameter, and
 * adding one would not help: 20261079 refuses the row by CHECK as well.
 *
 * WHAT THIS DOES NOT DO, and each is a test:
 *   - it does not write, update or supersede any Layer-1, Layer-2 or Layer-3
 *     row, so a determination cannot launder an exception or an effectiveness;
 *   - it does not touch the risk register or any risk acceptance. Accepting a
 *     risk is a different act at a different layer and must never rewrite an
 *     INDETERMINATE assurance basis into SUFFICIENT;
 *   - it computes and stores no requirement coverage.
 */
export async function recordSufficiencyDetermination(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }

  const reviewerUserId = requireHumanReviewer(req, res, "Determining requirement sufficiency");
  if (!reviewerUserId) return;

  const documentId = String(req.params["id"] ?? "").trim();
  if (!isUuid(documentId)) { res.status(400).json({ error: "document_id_must_be_uuid" }); return; }
  const resolutionId = String(req.params["resolutionId"] ?? "").trim();
  if (!isUuid(resolutionId)) { res.status(400).json({ error: "resolution_id_must_be_uuid" }); return; }

  const doc = await loadOutcomeDoc(documentId, organizationId);
  if (doc === null) { res.status(404).json({ error: "vendor_assurance_document_not_found" }); return; }

  // The same two preconditions Layer 2 enforces, for the same reason: a
  // governed determination cannot rest on a document nobody approved.
  if (doc.processing_status !== "approved") {
    res.status(409).json({
      error: "vendor_assurance_document_not_approved",
      status: doc.processing_status,
      detail: "Sufficiency is determined against the version of record. Approve the document first."
    });
    return;
  }
  if (doc.approved_by_user_id === null) {
    res.status(409).json({
      error: "vendor_assurance_document_approval_unattributed",
      detail: "This document was approved with no named approver, so it cannot carry a governed determination."
    });
    return;
  }
  if (doc.extraction_id === null) { res.status(409).json({ error: "vendor_assurance_extraction_missing" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const frameworkKey = typeof body["requirement_framework_key"] === "string" ? body["requirement_framework_key"].trim() : "";
  const frameworkVersion = typeof body["requirement_framework_version"] === "string" ? body["requirement_framework_version"].trim() : "";
  const requirementReference = typeof body["requirement_reference"] === "string" ? body["requirement_reference"].trim() : "";
  if (frameworkKey === "" || frameworkVersion === "" || requirementReference === "") {
    res.status(400).json({ error: "requirement_identity_required",
      detail: "requirement_framework_key, requirement_framework_version and requirement_reference are all required." });
    return;
  }
  const requested = body["determination"];
  if (!isSufficiencyDetermination(requested)) {
    res.status(400).json({ error: "determination_invalid", allowed: SUFFICIENCY_DETERMINATIONS });
    return;
  }
  const indeterminateReason = body["indeterminate_reason"] ?? null;
  if (requested === "INDETERMINATE") {
    if (!isSufficiencyIndeterminateReason(indeterminateReason)) {
      res.status(400).json({ error: "indeterminate_reason_required", allowed: SUFFICIENCY_INDETERMINATE_REASONS });
      return;
    }
  } else if (indeterminateReason !== null && indeterminateReason !== undefined) {
    res.status(400).json({ error: "indeterminate_reason_not_allowed",
      detail: "Only an INDETERMINATE determination carries a reason." });
    return;
  }
  const reviewerNoteRaw = body["reviewer_note"];
  if (reviewerNoteRaw !== undefined && reviewerNoteRaw !== null && typeof reviewerNoteRaw !== "string") {
    res.status(400).json({ error: "reviewer_note_invalid" }); return;
  }
  if (typeof reviewerNoteRaw === "string" && reviewerNoteRaw.length > MAX_REVIEWER_NOTE) {
    res.status(400).json({ error: "reviewer_note_too_long", max: MAX_REVIEWER_NOTE }); return;
  }
  const reviewerNote = typeof reviewerNoteRaw === "string" && reviewerNoteRaw.trim() !== "" ? reviewerNoteRaw : null;

  // The evaluation is recomputed HERE, at the moment of decision, and never
  // taken from the caller. A basis supplied by the client would be a basis the
  // client could weaken.
  const candidates = await loadSufficiencyCandidates(pg, {
    organizationId,
    documentId,
    extractionId: doc.extraction_id,
    acceptedOpinion: doc.assurance_opinion ?? null
  });
  const candidate = candidates.find(
    (c) => c.resolution_id === resolutionId
      && c.requirement_framework_key === frameworkKey
      && c.requirement_framework_version === frameworkVersion
      && c.requirement_reference === requirementReference
  );
  if (candidate === undefined) {
    res.status(404).json({ error: "sufficiency_candidate_not_found",
      detail: "This document produces no candidate for that resolution and requirement." });
    return;
  }

  const precondition = determinationPrecondition(requested, candidate.vetoes);
  if (!precondition.ok) {
    res.status(409).json({
      error: "sufficiency_blocked_by_vetoes",
      blocking: precondition.blocking,
      detail: "A coverage veto that fired, or that could not be evaluated, blocks a SUFFICIENT "
        + "determination. There is no override: record INSUFFICIENT or INDETERMINATE instead. "
        + "Tolerating a gap is a risk decision made elsewhere, not an assurance determination."
    });
    return;
  }

  const prior = await pg.query<{ id: string; determination: string }>(
    `SELECT id, determination
       FROM vendor_requirement_sufficiency_determinations
      WHERE resolution_id = $1 AND organization_id = $2
        AND requirement_framework_key = $3 AND requirement_framework_version = $4
        AND requirement_reference = $5 AND superseded_at IS NULL
      LIMIT 1`,
    [resolutionId, organizationId, frameworkKey, frameworkVersion, requirementReference]
  );
  const existing = prior.rows[0];
  if (existing !== undefined && body["supersede"] !== true) {
    res.status(409).json({
      error: "sufficiency_determination_already_recorded",
      current: existing.determination,
      detail: "A determination already stands for this candidate. Send supersede:true to replace it; "
        + "the superseded row is retained."
    });
    return;
  }

  const basis = buildDeterminationBasis(candidate.vetoes, {
    element_key: candidate.element_key,
    tested_control_reference: candidate.tested_control_reference,
    canonical_control_id: candidate.canonical_control_id,
    crosswalk_id: candidate.crosswalk_id,
    requirement_id: candidate.requirement_id,
    document_id: documentId,
    extraction_id: doc.extraction_id,
    superseded_determination_id: existing?.id ?? null
  });

  // Two statements, not one data-modifying CTE.
  //
  // A `WITH superseded AS (UPDATE ...) INSERT ...` reads the same snapshot for
  // both arms, so the partial unique index still sees the OLD live row and the
  // insert dies on a duplicate key. The isolation suite caught exactly that.
  // `asTenant` already wraps this handler in a transaction, so the pair is
  // atomic without a CTE.
  if (existing !== undefined) {
    await pg.query(
      `UPDATE vendor_requirement_sufficiency_determinations
          SET superseded_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND superseded_at IS NULL`,
      [existing.id, organizationId]
    );
  }

  const inserted = await pg.query(
    `INSERT INTO vendor_requirement_sufficiency_determinations
       (organization_id, document_id, extraction_id, resolution_id, element_key,
        canonical_control_id, requirement_framework_key, requirement_framework_version,
        requirement_reference, determination, indeterminate_reason,
        determined_by_user_id, reviewer_note, basis, evaluator_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
     RETURNING id, determination, indeterminate_reason, determined_by_user_id,
               determined_at, reviewer_note, evaluator_version`,
    [
      organizationId, documentId, doc.extraction_id, resolutionId, candidate.element_key,
      candidate.canonical_control_id, frameworkKey, frameworkVersion, requirementReference,
      requested, requested === "INDETERMINATE" ? indeterminateReason : null,
      reviewerUserId, reviewerNote, JSON.stringify(basis), VETO_EVALUATOR_VERSION
    ]
  );

  writeAuditEvent({
    organizationId,
    actorApiKeyId: getApiKeyId(req),
    actorUserId: reviewerUserId,
    eventType: "vendor_assurance.requirement_sufficiency.determined",
    resourceType: "vendor_requirement_sufficiency_determination",
    resourceId: inserted.rows[0]?.id ?? null,
    payload: {
      document_id: documentId,
      resolution_id: resolutionId,
      element_key: candidate.element_key,
      requirement: `${frameworkKey}/${frameworkVersion}/${requirementReference}`,
      determination: requested,
      indeterminate_reason: requested === "INDETERMINATE" ? indeterminateReason : null,
      veto_counts: (basis as { counts?: unknown }).counts ?? null,
      superseded_determination_id: existing?.id ?? null,
      establishes_requirement_coverage: false
    },
    ipAddress: req.ip ?? null
  });

  res.status(200).json({
    determined: inserted.rows[0],
    vetoes: candidate.vetoes,
    establishes_requirement_coverage: false
  });
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

// ---- VA-S4-P2: governed auditor-opinion acceptance ----
// Identical guard stack to every other Vendor Assurance write. The route does
// NOT additionally require a user session at the middleware layer — that is not
// something this stack can express — so the handler refuses an unattributed
// caller with a 403 before any write. Accepting an opinion is governance work.

router.get(
  "/vendor-assurance/documents/:id/assurance-opinion",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(getVendorAssuranceOpinion)
);

router.post(
  "/vendor-assurance/documents/:id/assurance-opinion",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(acceptVendorAssuranceOpinion)
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

// ---- VA-S4-4C-3: the three-layer assurance outcome surface ----
//
// The read route carries the SAME guard stack as every other Vendor Assurance
// read. The two WRITE routes additionally carry requireCapability("assurance:review"):
// the AUTHORIZED ASSURANCE REVIEWER capability, added to the existing seat model
// rather than to a parallel authorization system.
//
// The capability is necessary and NOT sufficient. It answers "is this identity
// permitted"; it cannot answer "is this a human", because scopeForApiKey()
// resolves an API key to a full/admin seat and therefore grants it. Human
// authority is enforced twice more, on axes the capability system does not
// reach: `requireHumanReviewer` refuses an unattributed caller with a 403 before
// any write, and 20261076/20261077 refuse an unattributed governed decision at
// the database.

router.get(
  "/vendor-assurance/documents/:id/assurance-outcomes",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(getVendorAssuranceOutcomes)
);

router.post(
  "/vendor-assurance/documents/:id/tested-controls/:elementKey/effectiveness",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  requireCapability("assurance:review"),
  asTenant(acceptTestedControlEffectiveness)
);

router.post(
  "/vendor-assurance/exceptions/:exceptionId/effect",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  requireCapability("assurance:review"),
  asTenant(acceptExceptionEffect)
);

// ---- VA-S4-4C-4: the governed sufficiency determination ----
//
// Same guard stack as 4C-3, for the same reasons. The write route additionally
// carries requireHumanReviewer inside the handler and 20261079's INSERT trigger
// beneath it: capability, human attribution and the database are three
// independent axes, and a determination needs all three.

router.get(
  "/vendor-assurance/documents/:id/sufficiency-candidates",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(getSufficiencyCandidates)
);

router.post(
  "/vendor-assurance/documents/:id/candidates/:resolutionId/sufficiency",
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  requireCapability("assurance:review"),
  asTenant(recordSufficiencyDetermination)
);

export default router;
