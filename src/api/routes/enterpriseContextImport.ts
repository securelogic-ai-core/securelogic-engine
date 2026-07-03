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
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import { enforceEnterpriseEntityLimit } from "../lib/enterpriseEntityLimit.js";
import { enforceEntityLimit } from "../lib/entityLimit.js";
import { parseImportFile } from "../lib/enterpriseImportParser.js";
import {
  planImport,
  isImportEntityType,
  type ImportEntityType,
  type NormalizedImportInput
} from "../lib/enterpriseContextImport.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 } // 5 MB
});

const ENTERPRISE_TYPES: ReadonlySet<ImportEntityType> = new Set(["asset", "application", "data_store"]);

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

/** Existing dedup keys (lowercased names) already in the org for this type. */
async function existingKeys(entityType: ImportEntityType, orgId: string): Promise<Set<string>> {
  let sql: string;
  const params: unknown[] = [orgId];
  if (ENTERPRISE_TYPES.has(entityType)) {
    sql = `SELECT lower(name) AS k FROM enterprise_entities WHERE organization_id = $1 AND entity_type = $2`;
    params.push(entityType);
  } else if (entityType === "vendor") {
    sql = `SELECT lower(name) AS k FROM vendors WHERE organization_id = $1`;
  } else {
    sql = `SELECT lower(name) AS k FROM ai_systems WHERE organization_id = $1`;
  }
  const r = await pg.query<{ k: string }>(sql, params);
  return new Set(r.rows.map((row) => row.k));
}

/** Remaining capacity headroom (cap - used, floored at 0) for the relevant cap system. */
async function capHeadroom(entityType: ImportEntityType, orgId: string): Promise<number> {
  const limit = ENTERPRISE_TYPES.has(entityType)
    ? await enforceEnterpriseEntityLimit(orgId)
    : await enforceEntityLimit(orgId); // vendor + ai_system share max_monitored_entities
  return Math.max(0, limit.cap - limit.used);
}

/** Persist one normalized row. Returns true if a row was inserted (ON CONFLICT skips dups). */
async function insertOne(orgId: string, normalized: NormalizedImportInput): Promise<boolean> {
  if (normalized.kind === "vendor") {
    const v = normalized.input;
    const r = await pg.query(
      `INSERT INTO vendors (organization_id, name, service_description, category, criticality,
                            data_sensitivity, access_level, website, owner_user_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'active')
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, v.name, v.service_description, v.category, v.criticality, v.data_sensitivity, v.access_level, v.website]
    );
    return (r.rowCount ?? 0) > 0;
  }
  if (normalized.kind === "ai_system") {
    const a = normalized.input;
    const r = await pg.query(
      `INSERT INTO ai_systems (organization_id, name, use_case, owner_user_id, model_type,
                               data_classification, deployment_status, criticality, risk_classification)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, a.name, a.use_case, a.model_type, a.data_classification, a.deployment_status, a.criticality, a.risk_classification]
    );
    return (r.rowCount ?? 0) > 0;
  }
  // enterprise_entity (asset / application / data_store)
  const e = normalized.input;
  const r = await pg.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name, description, owner_user_id,
                                      status, criticality, confidence, provenance)
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, 'csv_import')
     ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, e.entity_type, e.name, e.description, e.status, e.criticality, e.confidence]
  );
  if ((r.rowCount ?? 0) === 0) return false;
  const id = r.rows[0]!.id;
  if (e.entity_type === "data_store" && e.data_store) {
    const ds = e.data_store;
    await pg.query(
      `INSERT INTO enterprise_data_stores (enterprise_entity_id, organization_id,
                                           data_classification, residency_region, retention_policy, encryption_at_rest)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, orgId, ds.data_classification, ds.residency_region, ds.retention_policy, ds.encryption_at_rest]
    );
  }
  return true;
}

export async function importEnterpriseContext(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const entityType = req.query.entity_type;
  if (!isImportEntityType(entityType)) {
    res.status(400).json({ error: "invalid_entity_type", detail: "entity_type must be asset, application, data_store, vendor, or ai_system" });
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
      if (await insertOne(orgId, row.normalized)) committed++;
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
  requireEntitlement("premium"),
  upload.single("file")
];

router.post("/enterprise-context/import", ...chain, asTenant(importEnterpriseContext));

export default router;
