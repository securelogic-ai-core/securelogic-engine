/**
 * connectors.ts — EAR Phase 3b: the connector configuration + sync surface.
 *
 *   GET    /api/connectors                — registry adapters merged with the
 *                                           org's configured state (keys only,
 *                                           NEVER secret values or ciphertext)
 *   PUT    /api/connectors/:id            — validate (adapter.validateConfig)
 *                                           + encrypt + upsert config
 *   DELETE /api/connectors/:id            — remove config (credential hygiene)
 *   POST   /api/connectors/:id/sync       — enqueue one connector_sync job
 *                                           (202; deduped against pending runs)
 *
 * Route chain mirrors assets.ts with BOTH flags first (double-fenced — 404
 * while either is dark): connectors are an ECL surface AND their syncs create
 * registry assets. Same per-org `enterprise_context` capability (one
 * commercial boundary). org_id from context only; asTenant on every handler.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { listConnectors, getConnector } from "../lib/connectors/registry.js";
import {
  getConnectorRow,
  listConnectorRows,
  upsertConnectorConfig,
  updateConnectorSchedule,
  deleteConnectorConfig,
  redactConnectorRow
} from "../lib/connectorConfigStore.js";
import { CONNECTOR_SYNC_JOB_TYPE } from "../lib/connectorSyncCore.js";
import { parseSyncIntervalMinutes } from "../lib/connectorScheduleCore.js";
import { connectorWritebackEnabled } from "../lib/connectorWritebackFlag.js";
import {
  enqueueWritebackIntents,
  listWritebackIntents,
  writebackStatusCounts,
  type WritebackIntentInput
} from "../lib/connectorWritebackStore.js";

const router = Router();

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

function auditActor(req: Request): { actorApiKeyId: string | null; actorUserId: string | null; ipAddress: string | null } {
  return {
    actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
    actorUserId: (req as { userId?: string }).userId ?? null,
    ipAddress: req.ip ?? null
  };
}

export async function listOrgConnectors(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const rows = await listConnectorRows(orgId);
  const byId = new Map(rows.map((r) => [r.connector_id, r]));

  const connectors = listConnectors().map((adapter) => {
    const row = byId.get(adapter.id);
    return {
      display_name: adapter.displayName,
      category: adapter.category,
      adapter_status: adapter.status,
      config_fields: adapter.configFields.map((f) => ({
        key: f.key,
        label: f.label,
        required: f.required,
        kind: f.kind
      })),
      ...(row
        ? redactConnectorRow(row)
        : {
            connector_id: adapter.id,
            configured: false,
            config_keys: [],
            enabled: false,
            last_sync_at: null,
            last_sync_status: null,
            last_sync_summary: null,
            sync_interval_minutes: null,
            next_sync_at: null,
            consecutive_failures: 0
          })
    };
  });

  res.status(200).json({ connectors });
}

export async function putConnectorConfig(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const connectorId = req.params.id;
  const adapter = typeof connectorId === "string" ? getConnector(connectorId) : undefined;
  if (!adapter) {
    res.status(404).json({ error: "unknown_connector" });
    return;
  }

  const body = req.body as { config?: unknown; enabled?: unknown; sync_interval_minutes?: unknown } | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "enabled_must_be_boolean" });
    return;
  }
  // E2.P1: optional schedule. undefined = leave unchanged; null = manual-only.
  const interval =
    body.sync_interval_minutes !== undefined ? parseSyncIntervalMinutes(body.sync_interval_minutes) : undefined;
  if (interval !== undefined && "error" in interval) {
    res.status(400).json(interval);
    return;
  }

  const validated = adapter.validateConfig(body.config);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  let row = await upsertConnectorConfig(orgId, adapter.id, validated.config, body.enabled === true);
  if (interval !== undefined) {
    row = (await updateConnectorSchedule(orgId, adapter.id, interval.value)) ?? row;
  }

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "connector.configured",
    resourceType: "enterprise_connector",
    resourceId: row.id,
    // Field KEYS only — never config values (they include credentials).
    payload: {
      connector_id: adapter.id,
      config_keys: Object.keys(validated.config).sort(),
      enabled: row.enabled,
      sync_interval_minutes: row.sync_interval_minutes
    }
  });

  res.status(200).json({ connector: redactConnectorRow(row) });
}

export async function deleteConnector(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const connectorId = req.params.id;
  if (typeof connectorId !== "string" || !getConnector(connectorId)) {
    res.status(404).json({ error: "unknown_connector" });
    return;
  }

  const removed = await deleteConnectorConfig(orgId, connectorId);
  if (!removed) {
    res.status(404).json({ error: "not_configured" });
    return;
  }

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "connector.deleted",
    resourceType: "enterprise_connector",
    resourceId: null,
    payload: { connector_id: connectorId }
  });

  res.status(200).json({ deleted: true });
}

export async function triggerConnectorSync(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const connectorId = req.params.id;
  if (typeof connectorId !== "string" || !getConnector(connectorId)) {
    res.status(404).json({ error: "unknown_connector" });
    return;
  }

  const row = await getConnectorRow(orgId, connectorId);
  if (!row) {
    res.status(409).json({ error: "not_configured" });
    return;
  }
  if (!row.enabled) {
    res.status(409).json({ error: "connector_disabled" });
    return;
  }

  // One pending run per (org, connector) — the reassessment enqueue-dedup shape.
  const payload = JSON.stringify({ connector_id: connectorId });
  const enqueued = await pg.query<{ id: string }>(
    `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
     SELECT $1::uuid, NULL, $2, $3::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM jobs j
         WHERE j.organization_id = $1::uuid
           AND j.job_type = $2
           AND j.status IN ('queued', 'processing')
           AND j.payload = $3::jsonb
      )
     RETURNING id`,
    [orgId, CONNECTOR_SYNC_JOB_TYPE, payload]
  );
  const jobId = enqueued.rows[0]?.id ?? null;
  if (!jobId) {
    res.status(409).json({ error: "sync_already_pending" });
    return;
  }

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "connector.sync_requested",
    resourceType: "enterprise_connector",
    resourceId: row.id,
    payload: { connector_id: connectorId, job_id: jobId }
  });

  res.status(202).json({ job_id: jobId, connector_id: connectorId, status: "queued" });
}

// ERIP E2a: bidirectional writeback. Limits keep one request bounded; the field
// whitelist is the adapter's (only writable columns can be enqueued).
const MAX_WRITEBACK_INTENTS_PER_REQUEST = 500;
const MAX_EXTERNAL_REF_LEN = 200;
const MAX_DESIRED_VALUE_LEN = 1000;

/**
 * POST /api/connectors/:id/writeback — enqueue writeback intents (push
 * whitelisted external fields back to the source). Dark behind the writeback
 * flag (404 while off). The connector must support writeback and be configured.
 * Each intent's `field` must be in the adapter's writeback whitelist.
 */
export async function enqueueConnectorWriteback(req: Request, res: Response): Promise<void> {
  if (!connectorWritebackEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const connectorId = req.params.id;
  if (typeof connectorId !== "string") {
    res.status(404).json({ error: "unknown_connector" });
    return;
  }
  const adapter = getConnector(connectorId);
  if (!adapter) {
    res.status(404).json({ error: "unknown_connector" });
    return;
  }
  if (!adapter.writeback) {
    res.status(400).json({ error: "writeback_not_supported" });
    return;
  }

  const body = req.body as { intents?: unknown } | null;
  const rawIntents = body && Array.isArray(body.intents) ? body.intents : null;
  if (!rawIntents || rawIntents.length === 0) {
    res.status(400).json({ error: "intents_required" });
    return;
  }
  if (rawIntents.length > MAX_WRITEBACK_INTENTS_PER_REQUEST) {
    res.status(400).json({ error: "too_many_intents", detail: `max ${MAX_WRITEBACK_INTENTS_PER_REQUEST}` });
    return;
  }
  const allowed = new Set(adapter.writeback.fields);
  const intents: WritebackIntentInput[] = [];
  for (const raw of rawIntents) {
    const o = raw as { external_ref?: unknown; field?: unknown; desired_value?: unknown };
    if (typeof o.external_ref !== "string" || o.external_ref.trim().length === 0 || o.external_ref.length > MAX_EXTERNAL_REF_LEN) {
      res.status(400).json({ error: "invalid_external_ref" });
      return;
    }
    if (typeof o.field !== "string" || !allowed.has(o.field)) {
      res.status(400).json({ error: "field_not_writable", detail: `writable fields: ${[...allowed].join(", ")}` });
      return;
    }
    if (typeof o.desired_value !== "string" || o.desired_value.length > MAX_DESIRED_VALUE_LEN) {
      res.status(400).json({ error: "invalid_desired_value" });
      return;
    }
    intents.push({ external_ref: o.external_ref.trim(), field: o.field, desired_value: o.desired_value });
  }

  // Must be configured for this org (worker only writes when also enabled).
  const row = await getConnectorRow(orgId, connectorId);
  if (!row) {
    res.status(409).json({ error: "not_configured" });
    return;
  }

  const userId = (req as { userId?: string }).userId ?? null;
  const enqueued = await enqueueWritebackIntents(orgId, connectorId, intents, "operator", userId);

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "connector.writeback_requested",
    resourceType: "enterprise_connector",
    resourceId: row.id,
    // Field/ref identities only — desired values are the org's own data but
    // kept out of the audit payload to stay minimal.
    payload: {
      connector_id: connectorId,
      intent_count: enqueued,
      fields: [...new Set(intents.map((i) => i.field))].sort()
    }
  });

  res.status(202).json({ connector_id: connectorId, enqueued });
}

/** GET /api/connectors/:id/writeback — intent list + per-status counts. */
export async function listConnectorWriteback(req: Request, res: Response): Promise<void> {
  if (!connectorWritebackEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const connectorId = req.params.id;
  if (typeof connectorId !== "string") {
    res.status(404).json({ error: "unknown_connector" });
    return;
  }
  const adapter = getConnector(connectorId);
  if (!adapter) {
    res.status(404).json({ error: "unknown_connector" });
    return;
  }

  const [counts, intents] = await Promise.all([
    writebackStatusCounts(orgId, connectorId),
    listWritebackIntents(orgId, connectorId)
  ]);
  res.status(200).json({
    connector_id: connectorId,
    writeback_supported: Boolean(adapter.writeback),
    writeback_fields: adapter.writeback ? [...adapter.writeback.fields] : [],
    status_counts: counts,
    intents: intents.map((i) => ({
      external_ref: i.external_ref,
      field: i.field,
      desired_value: i.desired_value,
      status: i.status,
      attempts: i.attempts,
      last_pushed_value: i.last_pushed_value,
      external_prev_value: i.external_prev_value,
      detail: i.detail,
      applied_at: i.applied_at,
      updated_at: i.updated_at
    }))
  });
}

const chain = [
  enterpriseContextFeatureFlag,
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/connectors", ...chain, asTenant(listOrgConnectors));
router.put("/connectors/:id", ...chain, asTenant(putConnectorConfig));
router.delete("/connectors/:id", ...chain, asTenant(deleteConnector));
router.post("/connectors/:id/sync", ...chain, asTenant(triggerConnectorSync));
router.post("/connectors/:id/writeback", ...chain, asTenant(enqueueConnectorWriteback));
router.get("/connectors/:id/writeback", ...chain, asTenant(listConnectorWriteback));

export default router;
