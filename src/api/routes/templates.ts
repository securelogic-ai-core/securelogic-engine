/**
 * templates.ts — Industry-starter-templates routes.
 *
 * Routes
 *   GET  /api/templates             — list available industries (gated)
 *   GET  /api/templates/:industry   — preview a single template (gated)
 *   POST /api/templates/load        — load into the requesting org (gated)
 *
 * The gate. SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED ('true' to enable in
 * production); non-production runtimes are always enabled. When the gate
 * is off, all three routes return 404 — the same shape a non-existent
 * route would return — so the surface is invisible to clients without
 * leaking the existence of a feature in development.
 *
 * Tenant rules
 *   organization_id is sourced from req.organizationContext, never from
 *   request bodies or path params. The loader takes the org id as an
 *   argument and never re-derives it.
 *
 * Entitlement
 *   Templates create platform inventory rows; gated to the same
 *   entitlement as /vendors and /controls — 'standard'.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  industryTemplatesEnabled,
  isTemplateReviewBlocked,
  loadTemplate,
  TemplateLoaderInputError,
  type LoadTemplateResult,
} from "../lib/templateLoader.js";
import {
  ALL_INDUSTRIES,
  TEMPLATES,
  isIndustryId,
  type IndustryId,
} from "../../templates/index.js";

const router = Router();

function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

/**
 * Gate guard. Returns true and writes a 404 when the env-var feature
 * gate is off. Callers should `if (gateClosed(res)) return;` immediately.
 */
function gateClosed(res: Response): boolean {
  if (industryTemplatesEnabled()) return false;
  // 404 — same as an unknown route. Do not 403; that confirms feature
  // existence to a probing client.
  res.status(404).json({ error: "not_found" });
  return true;
}

/* =========================================================
   GET /api/templates — list of industries with summary counts
   ========================================================= */

export function listTemplates(_req: Request, res: Response): void {
  if (gateClosed(res)) return;
  const summaries = ALL_INDUSTRIES.map((id) => {
    const t = TEMPLATES[id];
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      version: t.version,
      last_reviewed_at: t.last_reviewed_at,
      counts: {
        vendors:     t.vendors.length,
        ai_systems:  t.ai_systems.length,
        obligations: t.obligations.length,
        controls:    t.controls.length,
      },
      review_blocked: isTemplateReviewBlocked(t),
    };
  });
  res.status(200).json({ templates: summaries });
}

/* =========================================================
   GET /api/templates/:industry — preview, full content
   ========================================================= */

export function previewTemplate(req: Request, res: Response): void {
  if (gateClosed(res)) return;
  const industryId = String(req.params.industry ?? "").trim();
  if (!isIndustryId(industryId)) {
    // Return 404 rather than 400 — preserves the gate's invariant that
    // unknown industry ids and a closed gate look identical to clients.
    res.status(404).json({ error: "not_found" });
    return;
  }
  const template = TEMPLATES[industryId];
  res.status(200).json({
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      version: template.version,
      last_reviewed_at: template.last_reviewed_at,
      review_blocked: isTemplateReviewBlocked(template),
      vendors: template.vendors,
      ai_systems: template.ai_systems,
      obligations: template.obligations,
      controls: template.controls,
    },
  });
}

/* =========================================================
   POST /api/templates/load
   Body: { industry_id, selected_item_ids? }
     industry_id: 'healthcare-saas' | 'fintech' | 'b2b-ai'
     selected_item_ids?: string[]   (omitted = load all)
   Returns: LoadTemplateResult
   ========================================================= */

type LoadBody = {
  industry_id?: unknown;
  selected_item_ids?: unknown;
};

export async function loadTemplateRoute(
  req: Request,
  res: Response
): Promise<void> {
  if (gateClosed(res)) return;

  const organizationId = getOrgId(req);
  if (organizationId === null) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const body = (req.body ?? {}) as LoadBody;

  if (!isIndustryId(body.industry_id)) {
    res.status(400).json({
      error: "invalid_industry_id",
      detail: `industry_id must be one of: ${ALL_INDUSTRIES.join(", ")}`,
    });
    return;
  }
  const industryId: IndustryId = body.industry_id;

  // selected_item_ids is optional. When provided it must be an array of
  // strings; the loader builds a Set for membership tests.
  let selectedItemIds: Set<string> | undefined;
  if (body.selected_item_ids !== undefined) {
    if (!Array.isArray(body.selected_item_ids)) {
      res.status(400).json({
        error: "invalid_selected_item_ids",
        detail: "selected_item_ids must be an array of strings",
      });
      return;
    }
    if (!body.selected_item_ids.every((x) => typeof x === "string")) {
      res.status(400).json({
        error: "invalid_selected_item_ids",
        detail: "selected_item_ids entries must be strings",
      });
      return;
    }
    selectedItemIds = new Set<string>(body.selected_item_ids as string[]);
  }

  try {
    const result: LoadTemplateResult = await loadTemplate(
      organizationId,
      industryId,
      {
        ...(selectedItemIds !== undefined ? { selectedItemIds } : {}),
        actorUserId:   req.userId ?? null,
        actorApiKeyId: getApiKeyId(req),
        ipAddress:     req.ip ?? null,
      }
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof TemplateLoaderInputError) {
      res.status(400).json({ error: err.code, detail: err.message });
      return;
    }
    logger.error(
      { event: "template_load_route_failed", organizationId, industryId, err },
      "POST /api/templates/load failed"
    );
    res.status(500).json({ error: "template_load_failed" });
  }
}

/* =========================================================
   POST /api/me/dismiss-banner
   Body: { banner_key: string }
   Persists a banner-key into users.dismissed_banner_keys for the
   requesting user. Idempotent (array-deduped at write time).

   Lives in this router because the only banner-key in v1 is the
   industry-templates banner. If a future banner needs the same
   plumbing, move this to a dedicated user-preferences router and
   re-export from there.
   ========================================================= */

type DismissBody = { banner_key?: unknown };

export async function dismissBannerRoute(req: Request, res: Response): Promise<void> {
  const userId = req.userId ?? null;
  if (userId === null) {
    res.status(401).json({ error: "user_required" });
    return;
  }

  const body = (req.body ?? {}) as DismissBody;
  if (typeof body.banner_key !== "string" || body.banner_key.trim() === "") {
    res.status(400).json({ error: "banner_key_required" });
    return;
  }
  const bannerKey = body.banner_key.trim();
  // Bound the key shape so a malicious caller can't push junk into the
  // array. Letters, digits, dashes, colons — same shape as the template
  // item ids.
  if (!/^[a-z0-9:_-]{1,64}$/i.test(bannerKey)) {
    res.status(400).json({ error: "banner_key_invalid_shape" });
    return;
  }

  try {
    // COALESCE defensively in case a legacy row arrives with NULL despite
    // the column DEFAULT. array_append + deduplication via ARRAY(SELECT
    // DISTINCT ...) keeps the array tidy on repeated dismisses.
    await pg.query(
      `UPDATE users
          SET dismissed_banner_keys = ARRAY(
                SELECT DISTINCT unnest(
                  array_append(COALESCE(dismissed_banner_keys, '{}'::TEXT[]), $1)
                )
              )
        WHERE id = $2`,
      [bannerKey, userId]
    );
    res.status(200).json({ ok: true, banner_key: bannerKey });
  } catch (err) {
    logger.error(
      { event: "dismiss_banner_failed", userId, bannerKey, err },
      "POST /api/me/dismiss-banner failed"
    );
    res.status(500).json({ error: "dismiss_banner_failed" });
  }
}

/* =========================================================
   Router wiring
   ========================================================= */

router.get(
  "/templates",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  listTemplates
);

router.get(
  "/templates/:industry",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  previewTemplate
);

router.post(
  "/templates/load",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  loadTemplateRoute
);

// /me/dismiss-banner does NOT gate on the templates env var — banner
// dismissal must work even when the gate is off (e.g. the env var was
// flipped on, the user dismissed, the env var was flipped back off).
router.post(
  "/me/dismiss-banner",
  requireApiKey,
  attachOrganizationContext,
  dismissBannerRoute
);

export default router;
