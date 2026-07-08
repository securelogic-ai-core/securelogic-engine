/**
 * enterpriseContextImport.ts — ECL Slice 3: CSV/spreadsheet bulk import route.
 *
 *   POST /api/enterprise-context/import?entity_type=<t>&mode=preview|commit
 *     multipart file (CSV or XLSX). The first-class no-integration onboarding path
 *     for the five bulk types: asset, application, data_store (→ enterprise_entities),
 *     vendor (→ vendors), ai_system (→ ai_systems).
 *
 *   preview (default): parse → validate → dedup → cap-check → return the per-row plan.
 *                      Writes nothing.
 *   commit:            same plan, then persist the `ok` rows in ONE tenant transaction.
 *
 * Flag-gated (SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED — 404 before auth when off).
 * asTenant so parsing + reads + writes run org-scoped in one transaction. org_id from
 * context only. Validation reuses the manual-create validators (via planImport); no
 * second validation truth. v1 does NOT assign owner_user_id from the file (IDOR-safe —
 * cross-org user refs cannot be smuggled in); owners are assigned post-import.
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import { parseImportFile } from "../lib/enterpriseImportParser.js";
import { planImport, isImportEntityType } from "../lib/enterpriseContextImport.js";
// EAR Phase 3b: persistence extracted to the shared module so the connector
// sync worker reuses the SAME lane (dedup keys, caps, inserts, registry hooks).
import { existingKeys, capHeadroom, insertImportRow } from "../lib/enterpriseImportPersistence.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 } // 5 MB
});

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

export async function importEnterpriseContext(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const entityType = req.query.entity_type;
  if (!isImportEntityType(entityType)) {
    res.status(400).json({ error: "invalid_entity_type", detail: "entity_type must be asset, application, data_store, business_process, vendor, ai_system, or identity" });
    return;
  }

  const mode = req.query.mode ?? "preview";
  if (mode !== "preview" && mode !== "commit") {
    res.status(400).json({ error: "invalid_mode", detail: "mode must be preview or commit" });
    return;
  }

  const file = (req as { file?: { buffer: Buffer; originalname: string } }).file;
  if (!file) {
    res.status(400).json({ error: "no_file_uploaded" });
    return;
  }

  const parsed = await parseImportFile(file.buffer, file.originalname);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const keys = await existingKeys(entityType, orgId);
  const headroom = await capHeadroom(entityType, orgId);
  const plan = planImport({ entityType, rows: parsed.parsed.rows, existingKeys: keys, capHeadroom: headroom });

  if (mode === "preview") {
    res.status(200).json({ mode: "preview", truncated: parsed.parsed.truncated, ...plan });
    return;
  }

  // commit — persist the ok rows in this tenant transaction.
  let committed = 0;
  for (const row of plan.rows) {
    if (row.status === "ok" && row.normalized) {
      if (await insertImportRow(orgId, row.normalized, "csv_import")) committed++;
    }
  }

  logger.info(
    { event: "enterprise_context_import", organizationId: orgId, entityType, committed, planned: plan.summary.ok },
    "Enterprise context import committed"
  );
  writeAuditEvent({
    organizationId: orgId,
    actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
    actorUserId: (req as { userId?: string }).userId ?? null,
    eventType: "enterprise_context.imported",
    resourceType: "enterprise_context_import",
    resourceId: null,
    payload: { entity_type: entityType, committed, summary: plan.summary },
    ipAddress: req.ip ?? null
  });

  res.status(200).json({ mode: "commit", committed, truncated: parsed.parsed.truncated, ...plan });
}

const chain = [
  enterpriseContextFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context"),
  upload.single("file")
];

router.post("/enterprise-context/import", ...chain, asTenant(importEnterpriseContext));

export default router;
