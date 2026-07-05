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

const chain = [
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/assets", ...chain, asTenant(listAssets));

export default router;
