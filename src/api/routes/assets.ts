/**
 * assets.ts — Enterprise Asset Registry, Phase 0 read surface.
 *
 *   GET /api/assets
 *
 * The unified cross-type asset list over `asset_registry_v` (20260802 view —
 * vendors ∪ ai_systems ∪ enterprise_entities projected to the canonical
 * header, ARCHITECTURE.md §2.1/§3.2). Read-only; per-type routes/pages remain
 * authoritative for type-specific detail (EAR-AD-1 federation).
 *
 * Route chain mirrors every ECL route: registry flag FIRST (404 while dark) →
 * auth → org context → capability → asTenant. Gated by its OWN flag
 * (SECURELOGIC_ASSET_REGISTRY_ENABLED, default off) so the registry can be
 * staged independently of the ECL surface, and by the SAME per-org capability
 * ("enterprise_context") — the registry federates the same platform inventory
 * the ECL owns, so a separate capability would be a second gating vocabulary
 * for one commercial boundary.
 *
 * Every query filters `WHERE organization_id = $1` inside the asTenant
 * transaction — explicit org discipline is the primary tenant control for the
 * view (vendors/ai_systems carry no RLS today; see the 20260802 migration
 * header for the security_invoker defense-in-depth).
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { isAssetType } from "../lib/assetRegistry.js";
import {
  validateAssetDetailCreate,
  validateAssetDetailUpdate,
  DETAIL_TABLE_SPEC,
  type DetailBackedType
} from "../lib/assetDetailValidation.js";
import {
  createDetailAsset,
  updateDetailAsset,
  deleteDetailAsset
} from "../lib/assetDetailPersistence.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MAX_OFFSET = 100_000;
const INTEGER_RE = /^-?\d+$/;

const ASSET_COLS = `
  asset_id, asset_type, organization_id, name, criticality, owner_user_id,
  status, backing_kind, backing_id, lifecycle_status, created_at, updated_at
`;

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

function parseBoundedInt(raw: unknown, fallback: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !INTEGER_RE.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
  return n;
}

export async function listAssets(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parseBoundedInt(req.query.offset, DEFAULT_OFFSET, MAX_OFFSET);
  if (limit === null || offset === null) {
    res.status(400).json({ error: "invalid_pagination" });
    return;
  }

  const rawType = req.query.asset_type;
  let typeFilter: string | null = null;
  if (rawType !== undefined) {
    if (!isAssetType(rawType)) {
      res.status(400).json({ error: "invalid_asset_type" });
      return;
    }
    typeFilter = rawType;
  }

  const rows = await pg.query(
    `SELECT ${ASSET_COLS}
       FROM asset_registry_v
      WHERE organization_id = $1
        AND ($2::text IS NULL OR asset_type = $2)
      ORDER BY name ASC, asset_id ASC
      LIMIT $3 OFFSET $4`,
    [orgId, typeFilter, limit, offset]
  );

  const total = await pg.query(
    `SELECT count(*)::int AS n
       FROM asset_registry_v
      WHERE organization_id = $1
        AND ($2::text IS NULL OR asset_type = $2)`,
    [orgId, typeFilter]
  );

  res.status(200).json({
    assets: rows.rows,
    total: Number((total.rows[0] as Record<string, unknown>).n),
    limit,
    offset
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * EAR Phase 3a: unified create for the four DETAIL-BACKED types only
 * (cloud_resource / endpoint / api / identity_system — the unified surface is
 * their CRUD home). vendor / ai_system / application / database /
 * business_process keep their per-type routes (EAR-AD-1 federation — the
 * registry never replaces them). Insert + registration are one tx (asTenant).
 */
export async function createAsset(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const validated = validateAssetDetailCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const result = await createDetailAsset(orgId, validated.input);
  if ("error" in result) {
    if (result.error === "cap_exceeded") {
      res.status(409).json({
        error: "asset_cap_exceeded",
        detail: `Your plan allows up to ${result.cap} assets of this type.`
      });
      return;
    }
    res.status(409).json({ error: result.error });
    return;
  }
  res.status(201).json({ asset: result.row });
}

/** Canonical header (view row) + typed detail for one asset. */
export async function getAsset(req: Request, res: Response): Promise<void> {
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

  const header = await pg.query(
    `SELECT ${ASSET_COLS} FROM asset_registry_v
      WHERE organization_id = $1 AND asset_id = $2
      LIMIT 1`,
    [orgId, id]
  );
  if (header.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = header.rows[0] as { backing_kind: string; backing_id: string };

  // Typed detail for the detail-backed kinds (closed dispatch — never input).
  const detailSpec = Object.values(DETAIL_TABLE_SPEC).find((s) => s.table === row.backing_kind);
  let detail: Record<string, unknown> | null = null;
  if (detailSpec) {
    const d = await pg.query(
      `SELECT * FROM ${detailSpec.table} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [row.backing_id, orgId]
    );
    detail = (d.rows[0] as Record<string, unknown>) ?? null;
  }

  res.status(200).json({ asset: header.rows[0], detail });
}

// ─── EAR P6: update / delete for detail-backed assets ─────────────────────────
//
// The unified surface is the CRUD home for the four detail-backed types ONLY
// (EAR-AD-1 — vendor/ai_system/entity-backed assets are managed on their
// authoritative per-type routes; mutating them here returns 409).

/** Resolve a registry id to its detail-backed type, or a typed refusal. */
async function resolveDetailBacked(
  orgId: string,
  id: string
): Promise<
  | { assetType: DetailBackedType; backingId: string; assetId: string }
  | { status: 400 | 404 | 409; error: string; detail?: string }
> {
  if (!UUID_RE.test(id)) return { status: 400, error: "invalid_id" };
  const reg = await pg.query(
    `SELECT id, backing_kind, backing_id FROM assets
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId]
  );
  const row = reg.rows[0] as { id: string; backing_kind: string; backing_id: string } | undefined;
  if (!row) return { status: 404, error: "not_found" };
  const spec = Object.entries(DETAIL_TABLE_SPEC).find(([, v]) => v.table === row.backing_kind);
  if (!spec) {
    return {
      status: 409,
      error: "not_detail_backed",
      detail: "This asset is managed on its own per-type route (vendors / AI systems / enterprise entities)."
    };
  }
  return { assetType: spec[0] as DetailBackedType, backingId: row.backing_id, assetId: row.id };
}

function auditActor(req: Request): { actorApiKeyId: string | null; actorUserId: string | null; ipAddress: string | null } {
  return {
    actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
    actorUserId: (req as { userId?: string }).userId ?? null,
    ipAddress: req.ip ?? null
  };
}

export async function updateAsset(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const resolved = await resolveDetailBacked(orgId, String(req.params.id ?? ""));
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error, ...(resolved.detail ? { detail: resolved.detail } : {}) });
    return;
  }
  const validated = validateAssetDetailUpdate(resolved.assetType, req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const result = await updateDetailAsset(orgId, resolved.assetType, resolved.backingId, validated.input.patch);
  if ("error" in result) {
    res.status(result.error === "not_found" ? 404 : 409).json({ error: result.error });
    return;
  }
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "asset.updated",
    resourceType: "asset",
    resourceId: resolved.assetId,
    payload: { asset_type: resolved.assetType, fields: Object.keys(validated.input.patch).sort() }
  });
  res.status(200).json({ asset: { ...result.row, asset_id: resolved.assetId } });
}

export async function deleteAsset(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const resolved = await resolveDetailBacked(orgId, String(req.params.id ?? ""));
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error, ...(resolved.detail ? { detail: resolved.detail } : {}) });
    return;
  }
  const result = await deleteDetailAsset(orgId, resolved.assetType, resolved.backingId);
  if (!result.deleted) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "asset.deleted",
    resourceType: "asset",
    resourceId: resolved.assetId,
    payload: { asset_type: resolved.assetType }
  });
  res.status(200).json({ deleted: true });
}

const chain = [
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/assets", ...chain, asTenant(listAssets));
router.get("/assets/:id", ...chain, asTenant(getAsset));
router.post("/assets", ...chain, asTenant(createAsset));
router.patch("/assets/:id", ...chain, asTenant(updateAsset));
router.delete("/assets/:id", ...chain, asTenant(deleteAsset));

export default router;
