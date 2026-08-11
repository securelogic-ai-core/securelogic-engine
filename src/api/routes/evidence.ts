/**
 * evidence.ts — Evidence primitives API
 *
 * Evidence records are org-scoped metadata attachments to assessment/workflow
 * records. They are immutable after creation.
 *
 * IMMUTABILITY:
 *   Evidence records are write-once. There is no PATCH and no DELETE route.
 *   Multiple evidence records may exist for the same source record.
 *
 * LINKAGE TARGETS:
 *   source_type = 'control_test'       -> control_assessments
 *   source_type = 'vendor_review'      -> vendor_assessments
 *   source_type = 'ai_review'          -> governance_reviews
 *   source_type = 'obligation_review'  -> obligation_assessments
 *
 * SCOPE:
 *   Metadata only. No file upload, no blob storage, no binary attachments.
 *
 * Routes:
 *   POST /api/evidence           — create evidence record
 *   GET  /api/evidence           — list by source_type + source_id (both required)
 *   GET  /api/evidence/:id       — get single evidence record
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { randomUUID, createHash } from "node:crypto";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { ownerCondition, mayAccessOwned } from "../lib/contributorScope.js";
import {
  validateEvidenceCreate,
  validateEvidenceListQuery
} from "../lib/evidenceValidation.js";
import {
  validateEvidenceFile,
  isAllowedUploadMime,
  ALLOWED_UPLOAD_LABELS,
  MAX_EVIDENCE_FILE_BYTES,
  MAX_ORG_EVIDENCE_STORAGE_BYTES,
} from "../lib/evidenceFileValidation.js";
import {
  putEvidenceFile,
  getEvidenceFileSignedUrl,
  deleteEvidenceFile,
  evidenceObjectKey,
} from "../lib/evidenceStorage.js";
import {
  BlobStorageNotConfiguredError,
  BlobStorageMalformedConfigError,
} from "../lib/blobStorageConfig.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { recomputeFindingOperationalStatus } from "../lib/findingLifecycle.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

// Maps source_type to the DB table that holds the linked record.
const SOURCE_TYPE_TABLE: Record<string, string> = {
  control_test: "control_assessments",
  vendor_review: "vendor_assessments",
  ai_review: "governance_reviews",
  ai_governance_review: "ai_governance_assessments",
  obligation_review: "obligation_assessments",
  dependency_review: "dependency_assessments",
  risk_treatment: "risk_treatments",
  finding: "findings",
  policy_review: "policies",
};

// ---------------------------------------------------------------------------
// buildEvidenceSummary — pure aggregation helper (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Aggregate evidence DB rows into a summary object.
 * All canonical source_type keys are always present; missing values default to 0.
 * Exported for unit testing without a live database.
 */
export function buildEvidenceSummary(
  bySourceTypeRows: ReadonlyArray<{ source_type: string; count: string }>
): {
  total: number;
  by_source_type: Record<string, number>;
} {
  const by_source_type: Record<string, number> = {
    control_test: 0,
    vendor_review: 0,
    ai_review: 0,
    ai_governance_review: 0,
    obligation_review: 0,
    dependency_review: 0,
    risk_treatment: 0,
    finding: 0
  };

  for (const row of bySourceTypeRows) {
    if (row.source_type in by_source_type) {
      by_source_type[row.source_type] = parseInt(row.count, 10);
    }
  }

  const total = Object.values(by_source_type).reduce((s, n) => s + n, 0);

  return { total, by_source_type };
}

// The raw storage_key is deliberately NOT selected — the client never needs the
// object key (downloads go through the signed-URL redirect, never a raw key).
// `has_file` is the boolean the UI branches on; the file metadata (name/type/size/
// sha256/uploader) is what it displays.
const EVIDENCE_SELECT = `
  id,
  organization_id,
  source_type,
  source_id,
  title,
  description,
  evidence_type,
  collected_at,
  collected_by,
  external_ref,
  original_filename,
  mime_type,
  -- BIGINT would serialize as a string over node-pg; file sizes are bounded well
  -- under int4 (max 25 MB), so cast to a JS number for the client.
  byte_size::int AS byte_size,
  sha256,
  uploaded_by_user_id,
  (storage_key IS NOT NULL) AS has_file,
  created_at,
  updated_at
`;

/* =========================================================
   GET /api/evidence/summary
   Aggregate evidence counts by source_type for the org.
   All canonical source_type keys are always present (0 when absent).
   ========================================================= */

router.get(
  "/evidence/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  // Org-wide evidence roll-up is a governance view.
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const result = await pg.query<{ source_type: string; count: string }>(
        `
        SELECT source_type, COUNT(*)::text AS count
        FROM evidence
        WHERE organization_id = $1
        GROUP BY source_type
        `,
        [organizationId]
      );

      const summary = buildEvidenceSummary(result.rows);

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "evidence_summary_failed", err },
        "GET /api/evidence/summary failed"
      );
      res.status(500).json({ error: "evidence_summary_failed" });
    }
  })
);

/* =========================================================
   GET /api/evidence/recent
   The org-wide recent-evidence read (EG2 Tier 2 slice 8).

   The plain list route requires (source_type, source_id) — correct for the
   per-record sections, but it meant no surface could answer "what evidence
   does the organization have?". This is the additive org-wide read behind
   the /evidence page: latest N records, same projection as the list route
   (never the raw storage key). Registered BEFORE /evidence/:id so the
   literal path is not captured as an id.
   ========================================================= */

router.get(
  "/evidence/recent",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  // Org-wide "recent evidence" is a governance view.
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const rawLimit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 100);

    try {
      const result = await pg.query(
        `
        SELECT ${EVIDENCE_SELECT}
        FROM evidence
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        `,
        [organizationId, limit]
      );

      res.status(200).json({
        organizationId,
        count: result.rowCount ?? 0,
        evidence: result.rows,
      });
    } catch (err) {
      logger.error(
        { event: "evidence_recent_failed", err },
        "GET /api/evidence/recent failed"
      );
      res.status(500).json({ error: "evidence_recent_failed" });
    }
  })
);

/* =========================================================
   POST /api/evidence
   Create an evidence record.
   Verifies that the linked source record exists and belongs to this org.
   Multiple evidence records are allowed for the same source.
   ========================================================= */

router.post(
  "/evidence",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateEvidenceCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;
    const targetTable = SOURCE_TYPE_TABLE[input.source_type];

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the linked source record exists and belongs to this org.
      const sourceResult = await client.query(
        `SELECT id FROM ${targetTable} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [input.source_id, organizationId]
      );

      if ((sourceResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "source_record_not_found" });
        return;
      }

      const evidenceResult = await client.query(
        `
        INSERT INTO evidence (
          organization_id,
          source_type,
          source_id,
          title,
          description,
          evidence_type,
          collected_at,
          collected_by,
          external_ref
        )
        VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9)
        RETURNING ${EVIDENCE_SELECT}
        `,
        [
          organizationId,
          input.source_type,
          input.source_id,
          input.title,
          input.description ?? null,
          input.evidence_type,
          input.collected_at ?? null,
          input.collected_by ?? null,
          input.external_ref ?? null
        ]
      );

      const evidence = evidenceResult.rows[0];

      await client.query("COMMIT");

      // Finding evidence participates in the operational derivation when the
      // org enforces the evidence gate (finding-lifecycle-spec §4: "new
      // evidence → op recomputed"). Attaching the required evidence to a
      // finding whose Actions are already terminal advances it to remediated
      // (→ ready-for-decision) without waiting for another Action write.
      if (input.source_type === "finding") {
        const recompute = await recomputeFindingOperationalStatus(
          organizationId,
          input.source_id,
          {
            actorUserId: (req.userId as string | undefined) ?? null,
            actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
          }
        );
        if (recompute.changed && recompute.auditEvent) {
          writeAuditEvent({
            organizationId,
            actorApiKeyId: (req as any).apiKey?.id ?? null,
            actorUserId: req.userId ?? null,
            eventType: recompute.auditEvent,
            resourceType: "finding",
            resourceId: input.source_id,
            payload: { from: recompute.fromState ?? null, to: recompute.toState ?? null, trigger: "evidence.created" },
            ipAddress: req.ip ?? null,
          });
        }
      }

      logger.info(
        {
          event: "evidence_created",
          organizationId,
          evidenceId: evidence.id,
          sourceType: input.source_type,
          sourceId: input.source_id,
          evidenceType: input.evidence_type
        },
        "Evidence record created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "evidence.created",
        resourceType: "evidence",
        resourceId: evidence.id as string,
        payload: { source_type: input.source_type, source_id: input.source_id },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ evidence });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "evidence_create_failed", err },
        "POST /api/evidence failed"
      );
      res.status(500).json({ error: "evidence_create_failed" });
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   GET /api/evidence
   List all evidence for a given source record.
   Both source_type and source_id query params are required.
   Returns all matching evidence ordered by created_at DESC.
   ========================================================= */

router.get(
  "/evidence",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateEvidenceListQuery(req.query);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      // Contributor seats see only evidence they uploaded, regardless of which
      // source object is queried — so an arbitrary source_id cannot enumerate
      // other people's evidence. Inert for others / flag off.
      const params: unknown[] = [organizationId, input.source_type, input.source_id];
      const oc = ownerCondition(req, "uploaded_by_user_id", params);
      const result = await pg.query(
        `
        SELECT ${EVIDENCE_SELECT}
        FROM evidence
        WHERE organization_id = $1
          AND source_type = $2
          AND source_id = $3::uuid
          ${oc ? `AND ${oc}` : ""}
        ORDER BY created_at DESC, id DESC
        `,
        params
      );

      const evidenceList = result.rows;

      res.status(200).json({
        count: evidenceList.length,
        organizationId,
        source_type: input.source_type,
        source_id: input.source_id,
        evidence: evidenceList
      });
    } catch (err) {
      logger.error(
        { event: "evidence_list_failed", err },
        "GET /api/evidence failed"
      );
      res.status(500).json({ error: "evidence_list_failed" });
    }
  })
);

/* =========================================================
   GET /api/evidence/:id
   Get a single evidence record by id.
   Returns 404 if not found or belongs to a different org.
   ========================================================= */

router.get(
  "/evidence/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const evidenceId = String(req.params.id ?? "").trim();
    if (!evidenceId) {
      res.status(400).json({ error: "evidence_id_required" });
      return;
    }
    if (!isUuid(evidenceId)) {
      res.status(400).json({ error: "evidence_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${EVIDENCE_SELECT}
        FROM evidence
        WHERE id = $1
          AND organization_id = $2
        `,
        [evidenceId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "evidence_not_found" });
        return;
      }

      // Contributor seats may read only evidence they uploaded; else 404.
      if (!mayAccessOwned(req, result.rows[0].uploaded_by_user_id)) {
        res.status(404).json({ error: "evidence_not_found" });
        return;
      }

      res.status(200).json({ evidence: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "evidence_get_failed", err },
        "GET /api/evidence/:id failed"
      );
      res.status(500).json({ error: "evidence_get_failed" });
    }
  })
);

/* =========================================================
   POST /api/evidence/upload   (multipart/form-data)
   Attach an uploaded FILE as evidence. Fields: file + the same metadata the
   JSON POST accepts (source_type, source_id, title, evidence_type, optional
   description/collected_at/collected_by/external_ref).

   Fail-closed ordering so a failure NEVER leaves a false evidence record (which
   would wrongly satisfy the remediation evidence gate):
     1. validate the file bytes (allowlist + magic-number + size);
     2. verify the linked source belongs to the org (404 on cross-org);
     3. enforce the per-org storage quota;
     4. write the blob to R2 FIRST (org-prefixed key, never a public URL);
     5. only then INSERT the evidence row + recompute the finding op-status,
        atomically in one tenant transaction. If the INSERT fails, the blob is
        deleted so nothing is orphaned and no row exists.
   ========================================================= */

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EVIDENCE_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // First gate — declared MIME must be in the allowlist. The authoritative
    // magic-byte check runs in the handler (fileFilter has no buffer).
    if (!isAllowedUploadMime(file.mimetype)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});

// Run multer and translate its errors into typed JSON (the default Express
// handler would return an HTML 500 for an oversized file).
function runEvidenceUpload(req: Request, res: Response, next: () => void): void {
  evidenceUpload.single("file")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "file_too_large",
          detail: `Max ${Math.floor(MAX_EVIDENCE_FILE_BYTES / (1024 * 1024))} MB`,
        });
        return;
      }
      res.status(400).json({ error: "upload_error", detail: err.code });
      return;
    }
    if ((err as Error)?.message === "unsupported_file_type") {
      res.status(415).json({
        error: "unsupported_file_type",
        detail: `Allowed: ${ALLOWED_UPLOAD_LABELS.join(", ")}`,
      });
      return;
    }
    res.status(400).json({ error: "upload_error" });
  });
}

async function uploadEvidenceHandler(req: Request, res: Response): Promise<void> {
  const organizationId =
    (req as unknown as { organizationContext?: { organizationId?: string } }).organizationContext
      ?.organizationId ?? null;
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const actorUserId = (req as unknown as { userId?: string }).userId ?? null;
  const actorApiKeyId = (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "no_file_uploaded" });
    return;
  }

  // 1. Authoritative file validation — allowlist + magic bytes + size.
  const fileCheck = validateEvidenceFile({
    declaredMime: file.mimetype,
    buffer: file.buffer,
    size: file.size,
    originalName: file.originalname,
  });
  if (!fileCheck.ok) {
    res.status(fileCheck.error === "file_too_large" ? 413 : 400).json(fileCheck);
    return;
  }

  // Metadata: multipart fields arrive as strings on req.body — the SAME contract
  // as the JSON POST (source_type/source_id/title/evidence_type + optional).
  const metaValidated = validateEvidenceCreate(req.body);
  if ("error" in metaValidated) {
    res.status(400).json(metaValidated);
    return;
  }
  const meta = metaValidated.input;
  const targetTable = SOURCE_TYPE_TABLE[meta.source_type];
  if (!targetTable) {
    res.status(400).json({ error: "invalid_source_type" });
    return;
  }

  // 2. Source must belong to the org (404 on cross-org — never a store first).
  const sourceOk = await withTenant(organizationId, async () => {
    const r = await pg.query(
      `SELECT 1 FROM ${targetTable} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [meta.source_id, organizationId]
    );
    return (r.rowCount ?? 0) > 0;
  });
  if (!sourceOk) {
    res.status(404).json({ error: "source_record_not_found" });
    return;
  }

  // 3. Per-org storage quota (soft cap; sum of file-backed rows).
  const used = await withTenant(organizationId, async () => {
    const r = await pg.query<{ total: string }>(
      `SELECT COALESCE(SUM(byte_size), 0)::text AS total
         FROM evidence WHERE organization_id = $1 AND storage_key IS NOT NULL`,
      [organizationId]
    );
    return Number(r.rows[0]?.total ?? "0");
  });
  if (used + file.size > MAX_ORG_EVIDENCE_STORAGE_BYTES) {
    res.status(409).json({
      error: "org_storage_quota_exceeded",
      used_bytes: used,
      limit_bytes: MAX_ORG_EVIDENCE_STORAGE_BYTES,
    });
    return;
  }

  // 4. Write the blob FIRST, under a pre-generated evidence id, so a failed put
  //    never produces a DB row. The key is org-prefixed by blobStorage.
  const evidenceId = randomUUID();
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  try {
    await putEvidenceFile({
      organizationId,
      evidenceId,
      bytes: file.buffer,
      contentType: fileCheck.mime,
      filename: fileCheck.filename,
    });
  } catch (err) {
    if (
      err instanceof BlobStorageNotConfiguredError ||
      err instanceof BlobStorageMalformedConfigError
    ) {
      logger.error({ event: "evidence_storage_unconfigured", organizationId }, "Evidence upload attempted but blob storage is not configured");
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }
    logger.error(
      { event: "evidence_blob_put_failed", organizationId, evidenceId, err },
      "Evidence file upload to blob storage failed"
    );
    res.status(500).json({ error: "blob_put_failed" });
    return;
  }

  // 5. INSERT the row + recompute the finding op-status ATOMICALLY. If this
  //    fails, delete the blob so a failed upload leaves NOTHING behind.
  let result: {
    row: Record<string, unknown>;
    recompute: { changed: boolean; auditEvent?: string; fromState?: string; toState?: string } | null;
  };
  try {
    result = await withTenant(organizationId, async () => {
      const storageKey = evidenceObjectKey(organizationId, evidenceId);
      const ins = await pg.query(
        `INSERT INTO evidence (
           id, organization_id, source_type, source_id, title, description,
           evidence_type, collected_at, collected_by, external_ref,
           storage_key, original_filename, mime_type, byte_size, sha256,
           uploaded_by_user_id
         )
         VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16)
         RETURNING ${EVIDENCE_SELECT}`,
        [
          evidenceId,
          organizationId,
          meta.source_type,
          meta.source_id,
          meta.title,
          meta.description ?? null,
          meta.evidence_type,
          meta.collected_at ?? null,
          meta.collected_by ?? null,
          meta.external_ref ?? null,
          storageKey,
          fileCheck.filename,
          fileCheck.mime,
          file.size,
          sha256,
          actorUserId,
        ]
      );
      const row = ins.rows[0] as Record<string, unknown>;

      // The evidence gate advances the finding ONLY here, in the same
      // transaction as the row — so it can never advance without a persisted row.
      let recompute:
        | { changed: boolean; auditEvent?: string; fromState?: string; toState?: string }
        | null = null;
      if (meta.source_type === "finding") {
        recompute = await recomputeFindingOperationalStatus(organizationId, meta.source_id, {
          actorUserId,
          actorApiKeyId,
        });
      }
      return { row, recompute };
    });
  } catch (err) {
    // Compensate: the row did not commit, so remove the orphaned blob.
    try {
      await deleteEvidenceFile({ organizationId, evidenceId });
    } catch (cleanupErr) {
      logger.error(
        { event: "evidence_blob_cleanup_failed", organizationId, evidenceId, err: cleanupErr },
        "Failed to clean up evidence blob after row insert failed"
      );
    }
    logger.error(
      { event: "evidence_file_create_failed", organizationId, evidenceId, err },
      "Evidence file record insert failed"
    );
    res.status(500).json({ error: "evidence_create_failed" });
    return;
  }

  writeAuditEvent({
    organizationId,
    actorApiKeyId,
    actorUserId,
    eventType: "evidence.file_uploaded",
    resourceType: "evidence",
    resourceId: evidenceId,
    payload: {
      source_type: meta.source_type,
      source_id: meta.source_id,
      original_filename: fileCheck.filename,
      mime_type: fileCheck.mime,
      byte_size: file.size,
      sha256,
    },
    ipAddress: req.ip ?? null,
  });

  if (result.recompute?.changed && result.recompute.auditEvent) {
    writeAuditEvent({
      organizationId,
      actorApiKeyId,
      actorUserId,
      eventType: result.recompute.auditEvent,
      resourceType: "finding",
      resourceId: meta.source_id,
      payload: {
        from: result.recompute.fromState ?? null,
        to: result.recompute.toState ?? null,
        trigger: "evidence.file_uploaded",
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(201).json({ evidence: result.row });
}

router.post(
  "/evidence/upload",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  runEvidenceUpload,
  (req, res) => {
    void uploadEvidenceHandler(req, res).catch((err) => {
      logger.error({ event: "evidence_upload_unhandled", err }, "POST /api/evidence/upload failed");
      if (!res.headersSent) res.status(500).json({ error: "evidence_upload_failed" });
    });
  }
);

/* =========================================================
   GET /api/evidence/:id/file
   302 → a single-org, short-lived pre-signed URL (TTL ≤ 90s). Never a public
   object URL. 404 on cross-org OR on a reference-only (no-file) evidence row.
   ========================================================= */

// NOT wrapped in asTenant: that middleware buffers the handler's response and
// replays it after COMMIT, which does not carry a redirect. The read is a single
// org-scoped query run inside withTenant (so RLS is satisfied); the 302 is then
// issued on the real `res` at top level — the same shape as the vendor-assurance
// PDF redirect.
router.get(
  "/evidence/:id/file",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    try {
      const organizationId =
        (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      const evidenceId = String(req.params.id ?? "").trim();
      if (!isUuid(evidenceId)) {
        res.status(400).json({ error: "evidence_id_must_be_uuid" });
        return;
      }

      const row = await withTenant(organizationId, () =>
        pg.query<{ storage_key: string | null; uploaded_by_user_id: string | null }>(
          `SELECT storage_key, uploaded_by_user_id FROM evidence WHERE id = $1 AND organization_id = $2`,
          [evidenceId, organizationId]
        )
      );
      // Contributor seats may download only files they uploaded; else 404.
      if ((row.rowCount ?? 0) > 0 && !mayAccessOwned(req, row.rows[0]?.uploaded_by_user_id)) {
        res.status(404).json({ error: "evidence_not_found" });
        return;
      }
      if ((row.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "evidence_not_found" });
        return;
      }
      if (!row.rows[0]!.storage_key) {
        // Reference-only evidence — nothing to download.
        res.status(404).json({ error: "evidence_has_no_file" });
        return;
      }

      let signed: { url: string; ttlSeconds: number; expiresAt: Date };
      try {
        signed = await getEvidenceFileSignedUrl({ organizationId, evidenceId });
      } catch (err) {
        if (
          err instanceof BlobStorageNotConfiguredError ||
          err instanceof BlobStorageMalformedConfigError
        ) {
          res.status(503).json({ error: "storage_unavailable" });
          return;
        }
        logger.error(
          { event: "evidence_signed_url_failed", organizationId, evidenceId, err },
          "Evidence signed URL issuance failed"
        );
        res.status(500).json({ error: "signed_url_failed" });
        return;
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "evidence.file_url_issued",
        resourceType: "evidence",
        resourceId: evidenceId,
        payload: { ttl_seconds: signed.ttlSeconds, expires_at: signed.expiresAt.toISOString() },
        ipAddress: req.ip ?? null,
      });

      res.redirect(302, signed.url);
    } catch (err) {
      logger.error({ event: "evidence_file_download_failed", err }, "GET /api/evidence/:id/file failed");
      if (!res.headersSent) res.status(500).json({ error: "evidence_file_download_failed" });
    }
  }
);

export default router;
