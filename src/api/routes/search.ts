/**
 * search.ts — federated global search across the canonical domain objects.
 *
 * Routes:
 *   GET /api/search?q=… — org-scoped, ranked results across findings, risks,
 *                         vendors, AI systems, controls, obligations, and
 *                         (flag + capability permitting) assets.
 *
 * Gating: mounts the same dual-gate as the other core-domain read routes
 * (premium entitlement OR the core_platform capability). The asset section is
 * additionally conditioned on the registry flag AND the org's
 * enterprise_context capability — the exact pair every dedicated asset
 * surface enforces — so search never widens an entitlement boundary.
 *
 * The capability lookup runs BEFORE the tenant wrap on the ambient pool
 * (same posture as requireCapability); a lookup failure degrades assets out
 * of the response rather than failing the search.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { resolveEnterpriseContextCapability } from "../lib/enterpriseContextCapability.js";
import { normalizeGlobalQuery, runGlobalSearch } from "../lib/globalSearch.js";

const router = Router();

interface OrgContextRequest extends Request {
  organizationContext?: {
    organizationId: string;
    entitlementLevel: string | null;
  };
  assetSearchEligible?: boolean;
}

/**
 * Non-denying: resolves whether the asset section may run and stashes the
 * answer on the request. Ambient-pool by design — it runs before asTenant,
 * mirroring requireCapability on the dedicated asset routes.
 */
async function attachAssetSearchEligibility(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const r = req as OrgContextRequest;
  r.assetSearchEligible = false;

  const ctx = r.organizationContext;
  if (!assetRegistryEnabled() || !ctx?.organizationId) {
    next();
    return;
  }

  try {
    const result = await pg.query<{ enterprise_context_capability: boolean | null }>(
      "SELECT enterprise_context_capability FROM organizations WHERE id = $1 LIMIT 1",
      [ctx.organizationId]
    );
    const override = result.rows[0]?.enterprise_context_capability ?? null;
    r.assetSearchEligible = resolveEnterpriseContextCapability(
      ctx.entitlementLevel,
      override
    );
  } catch (err) {
    logger.error(
      { event: "global_search_capability_check_failed", err, orgId: ctx.organizationId },
      "asset capability lookup failed — searching without the asset section"
    );
  }
  next();
}

router.get(
  "/search",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  attachAssetSearchEligibility,
  asTenant(async (req, res) => {
    const r = req as OrgContextRequest;
    const organizationId = r.organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const query = normalizeGlobalQuery(req.query["q"]);
    if (query === null) {
      res.status(400).json({ error: "invalid_query" });
      return;
    }

    try {
      const results = await runGlobalSearch(pg, organizationId, query, {
        includeAssets: r.assetSearchEligible === true,
        onTypeError: (type, err) => {
          logger.error(
            { event: "global_search_type_failed", type, err, orgId: organizationId },
            "global search section failed — degraded to zero hits"
          );
        },
      });
      res.json(results);
    } catch (err) {
      logger.error(
        { event: "global_search_failed", err, orgId: organizationId },
        "global search failed"
      );
      res.status(500).json({ error: "internal_error" });
    }
  })
);

export default router;
