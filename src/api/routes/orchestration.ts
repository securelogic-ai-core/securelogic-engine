/**
 * orchestration.ts — ERIP Epic 6 (Autonomous Operations): the approval-gated
 * orchestration surface. A proposal is INERT until a DIFFERENT human approves
 * it (ERIP-AD-24/25); on approval its executor runs and the outcome is
 * recorded. Every transition is audited (ERIP-AD-26).
 *
 *   POST   /api/orchestration/proposals            — propose (→ proposed)
 *   GET    /api/orchestration/proposals            — list (org-scoped)
 *   POST   /api/orchestration/proposals/:id/approve — SoD-checked → executed|failed
 *   POST   /api/orchestration/proposals/:id/reject  — → rejected
 *
 * Route chain: the Autonomous-Operations flag FIRST (404 while dark), then
 * auth, org context, the per-org `enterprise_context` capability, asTenant.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { autonomousOperationsFeatureFlag } from "../lib/autonomousOperationsFeatureFlag.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  canTransition,
  approvalAllowed,
  isProposalType,
  validateProposalPayload,
  type ProposalType,
  type ProposalStatus
} from "../lib/orchestrationPolicy.js";
import { dispatchExecutor } from "../lib/orchestrationExecutors.js";
import {
  listIntegrationRows,
  upsertIntegrationConfig,
  deleteIntegrationConfig,
  redactIntegrationRow,
  isIntegrationId,
  INTEGRATION_IDS
} from "../lib/orchestrationIntegrationStore.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}
function getUserId(req: Request): string | null {
  return (req as { userId?: string }).userId ?? null;
}
function auditActor(req: Request): { actorApiKeyId: string | null; actorUserId: string | null; ipAddress: string | null } {
  return {
    actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
    actorUserId: getUserId(req),
    ipAddress: req.ip ?? null
  };
}

interface ProposalRow {
  id: string;
  proposal_type: string;
  title: string;
  payload: Record<string, unknown>;
  status: ProposalStatus;
  proposed_by_user_id: string | null;
  approved_by_user_id: string | null;
  execution_result: Record<string, unknown> | null;
  executed_at: string | null;
  created_at: string;
}

const ROW_COLS =
  "id, proposal_type, title, payload, status, proposed_by_user_id, approved_by_user_id, execution_result, executed_at, created_at";

export async function createProposal(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const body = req.body as { proposal_type?: unknown; title?: unknown; payload?: unknown } | null;
  if (body === null || typeof body !== "object") {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  if (!isProposalType(body.proposal_type)) {
    res.status(400).json({ error: "invalid_proposal_type" });
    return;
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > 200) {
    res.status(400).json({ error: "invalid_title" });
    return;
  }
  const validated = validateProposalPayload(body.proposal_type, body.payload);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  const r = await pg.query<ProposalRow>(
    `INSERT INTO orchestration_proposals (organization_id, proposal_type, title, payload, proposed_by_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING ${ROW_COLS}`,
    [orgId, body.proposal_type, title, JSON.stringify(validated.payload), getUserId(req)]
  );
  const row = r.rows[0]!;
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "orchestration.proposed",
    resourceType: "orchestration_proposal",
    resourceId: row.id,
    payload: { proposal_type: row.proposal_type, title: row.title }
  });
  res.status(201).json({ proposal: row });
}

export async function listProposals(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const r = await pg.query<ProposalRow>(
    `SELECT ${ROW_COLS} FROM orchestration_proposals
      WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [orgId]
  );
  res.status(200).json({ proposals: r.rows });
}

export async function approveProposal(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const approver = getUserId(req);

  const cur = await pg.query<ProposalRow>(
    `SELECT ${ROW_COLS} FROM orchestration_proposals WHERE organization_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id]
  );
  const proposal = cur.rows[0];
  if (!proposal) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!canTransition(proposal.status, "approved")) {
    res.status(409).json({ error: "invalid_status", detail: `cannot approve a '${proposal.status}' proposal` });
    return;
  }
  const sod = approvalAllowed(proposal.proposed_by_user_id, approver);
  if (!sod.ok) {
    res.status(403).json({ error: sod.error });
    return;
  }

  // Approve → execute the type's real executor → executed|failed, in the tx.
  const validated = validateProposalPayload(proposal.proposal_type as ProposalType, proposal.payload);
  if ("error" in validated) {
    await pg.query(
      `UPDATE orchestration_proposals
          SET status = 'failed', approved_by_user_id = $3,
              execution_result = $4::jsonb, executed_at = now(), updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [orgId, id, approver, JSON.stringify({ error: "payload_invalid_at_execution" })]
    );
    res.status(409).json({ error: "payload_invalid_at_execution" });
    return;
  }

  // dispatchExecutor never throws — it returns a typed ok/error result. Config
  // load, the SSRF-safe outbound call, and internal writes all happen here.
  const exec = await dispatchExecutor(orgId, proposal.proposal_type, validated.payload);
  const result: Record<string, unknown> = exec.ok ? exec.result : { error: exec.error };
  const finalStatus: "executed" | "failed" = exec.ok ? "executed" : "failed";

  const upd = await pg.query<ProposalRow>(
    `UPDATE orchestration_proposals
        SET status = $3, approved_by_user_id = $4,
            execution_result = $5::jsonb, executed_at = now(), updated_at = now()
      WHERE organization_id = $1 AND id = $2
      RETURNING ${ROW_COLS}`,
    [orgId, id, finalStatus, approver, JSON.stringify(result)]
  );

  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: `orchestration.${finalStatus}`,
    resourceType: "orchestration_proposal",
    resourceId: id,
    payload: { proposal_type: proposal.proposal_type, result }
  });

  res.status(finalStatus === "executed" ? 200 : 500).json({ proposal: upd.rows[0] });
}

export async function rejectProposal(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const cur = await pg.query<{ status: ProposalStatus }>(
    `SELECT status FROM orchestration_proposals WHERE organization_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id]
  );
  const status = cur.rows[0]?.status;
  if (!status) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!canTransition(status, "rejected")) {
    res.status(409).json({ error: "invalid_status", detail: `cannot reject a '${status}' proposal` });
    return;
  }
  const r = await pg.query<ProposalRow>(
    `UPDATE orchestration_proposals SET status = 'rejected', updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING ${ROW_COLS}`,
    [orgId, id]
  );
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "orchestration.rejected",
    resourceType: "orchestration_proposal",
    resourceId: id,
    payload: {}
  });
  res.status(200).json({ proposal: r.rows[0] });
}

// ─── E6a: per-org integration configuration (encrypted; keys-only responses) ──

/** Required config field keys per integration. Email uses the shared sender. */
const REQUIRED_CONFIG: Record<string, readonly string[]> = {
  servicenow: ["instance_url", "username", "password"],
  jira: ["base_url", "email", "api_token", "project_key"],
  teams: ["webhook_url"],
  slack: ["webhook_url"],
  email: []
};

export async function listIntegrations(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const rows = await listIntegrationRows(orgId);
  const byId = new Map(rows.map((r) => [r.integration_id, r]));
  const integrations = INTEGRATION_IDS.map((id) => {
    const row = byId.get(id);
    return row
      ? redactIntegrationRow(row)
      : { integration_id: id, configured: false, config_keys: [], enabled: false };
  });
  res.status(200).json({ integrations });
}

export async function putIntegration(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const integrationId = req.params.id;
  if (!isIntegrationId(integrationId)) {
    res.status(404).json({ error: "unknown_integration" });
    return;
  }
  const body = req.body as { config?: unknown; enabled?: unknown } | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "enabled_must_be_boolean" });
    return;
  }
  const rawConfig = body.config;
  if (rawConfig === null || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    res.status(400).json({ error: "config_must_be_object" });
    return;
  }
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawConfig as Record<string, unknown>)) {
    if (typeof v !== "string") {
      res.status(400).json({ error: "config_field_type", detail: `${k} must be a string` });
      return;
    }
    config[k] = v.trim();
  }
  for (const field of REQUIRED_CONFIG[integrationId]!) {
    if (!config[field]) {
      res.status(400).json({ error: "config_field_missing", detail: `${field} is required` });
      return;
    }
  }

  const row = await upsertIntegrationConfig(orgId, integrationId, config, body.enabled === true);
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "orchestration.integration_configured",
    resourceType: "orchestration_integration",
    resourceId: row.id,
    payload: { integration_id: integrationId, config_keys: Object.keys(config).sort(), enabled: row.enabled }
  });
  res.status(200).json({ integration: redactIntegrationRow(row) });
}

export async function deleteIntegration(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const integrationId = req.params.id;
  if (!isIntegrationId(integrationId)) {
    res.status(404).json({ error: "unknown_integration" });
    return;
  }
  const removed = await deleteIntegrationConfig(orgId, integrationId);
  if (!removed) {
    res.status(404).json({ error: "not_configured" });
    return;
  }
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "orchestration.integration_deleted",
    resourceType: "orchestration_integration",
    resourceId: null,
    payload: { integration_id: integrationId }
  });
  res.status(200).json({ deleted: true });
}

const chain = [
  autonomousOperationsFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.post("/orchestration/proposals", ...chain, asTenant(createProposal));
router.get("/orchestration/proposals", ...chain, asTenant(listProposals));
router.post("/orchestration/proposals/:id/approve", ...chain, asTenant(approveProposal));
router.post("/orchestration/proposals/:id/reject", ...chain, asTenant(rejectProposal));
router.get("/orchestration/integrations", ...chain, asTenant(listIntegrations));
router.put("/orchestration/integrations/:id", ...chain, asTenant(putIntegration));
router.delete("/orchestration/integrations/:id", ...chain, asTenant(deleteIntegration));

export default router;
