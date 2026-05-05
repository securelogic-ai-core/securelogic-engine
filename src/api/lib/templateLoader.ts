/**
 * templateLoader.ts — Pure loader for industry-starter templates.
 *
 * Given an org id, an industry id, and an optional whitelist of selected
 * item ids, this loader inserts the template's vendors / obligations /
 * controls into the requesting org's tables under a single transaction.
 *
 * Key invariants
 *   1. Single transaction. A failed INSERT anywhere in the load rolls back
 *      the entire load — no half-populated inventory.
 *   2. Additive, never overwrites. Every INSERT uses ON CONFLICT DO NOTHING
 *      against the destination table's UNIQUE constraint:
 *        - vendors:     UNIQUE (organization_id, name)
 *        - obligations: UNIQUE (organization_id, title)
 *        - controls:    UNIQUE (organization_id, name)
 *      Existing rows are unaffected. Loaded rows carry template_source =
 *      industryId for analytics-only attribution.
 *   3. Framework linkage via synthetic requirement + control_mapping.
 *      `controls` has no framework_id column; the path to a framework is
 *      controls → control_mappings → requirements → frameworks. For each
 *      distinct framework_ref the template references, the loader:
 *        a. Upserts a frameworks row (per-org) with (name, version)
 *           from FRAMEWORK_REFS.
 *        b. Upserts ONE synthetic requirements row per (framework, template)
 *           with reference_id = `industry-template:{industryId}` and a
 *           human-readable title. This is the one place template controls
 *           "live" in the framework readiness report.
 *        c. Inserts a control_mappings row from each newly-inserted control
 *           to the synthetic requirement.
 *      Pre-existing controls (skipped via ON CONFLICT) get NO new
 *      control_mapping — by design. The mapping is part of the load event;
 *      a manually-created control with the same name should not be
 *      retroactively framework-tagged just because a template would have
 *      tagged it.
 *   4. Tenant isolation. organization_id flows from the caller — never
 *      from a request body. The route layer is responsible for sourcing
 *      it from req.organizationContext.
 *   5. Audit fire-and-forget via writeAuditEvent. resource_type =
 *      'industry_template'; resource_id = NULL (industry_id is a slug,
 *      not a UUID); industry_id lives in payload alongside counts.
 *
 * NOT in scope
 *   - ai_systems insertion. v1 templates have empty ai_systems[]; the
 *     return shape reports `ai_systems: 0` always. The branch is wired
 *     so adding ai_systems entries to a future template version "just
 *     works" without loader changes.
 *   - Posture recompute, brief-surfacing, dashboard refresh. Those
 *     belong to revalidatePath calls in the server action layer.
 *   - selectedItemIds beyond simple Set membership filtering. No bulk
 *     batch optimizations; per-template loads are bounded (<150 rows).
 */

import type { PoolClient } from "pg";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "./auditLog.js";
import {
  FRAMEWORK_REFS,
  TEMPLATES,
  templateHasUnreviewedEntries,
  type FrameworkRef,
  type IndustryId,
  type Template,
} from "../../templates/index.js";

export type LoadTemplateResult = {
  industry_id: IndustryId;
  selected_count: number;
  inserted: {
    vendors: number;
    ai_systems: number;
    obligations: number;
    controls: number;
  };
  skipped: {
    vendors: number;
    ai_systems: number;
    obligations: number;
    controls: number;
  };
};

export type LoadTemplateOptions = {
  /**
   * Optional whitelist. When undefined, ALL items in the template load.
   * When provided, only items whose `id` matches one in the set load;
   * everything else is excluded from both inserts and counts.
   *
   * The Set holds the per-row stable ids built into each template
   * ({industry}:vendor:{slug}, etc.).
   */
  selectedItemIds?: ReadonlySet<string>;

  /**
   * Audit metadata flow-through. The route layer passes these so the
   * audit event records who triggered the load.
   */
  actorUserId?: string | null;
  actorApiKeyId?: string | null;
  ipAddress?: string | null;
};

/**
 * Errors the loader raises BEFORE opening a transaction. The route maps
 * these to specific 4xx codes; runtime DB errors hit the catch block in
 * the route and become 500.
 */
export class TemplateLoaderInputError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TemplateLoaderInputError";
  }
}

/**
 * Load a template into the given org.
 *
 * Pre-conditions (the route layer enforces these):
 *   - organizationId is sourced from req.organizationContext.
 *   - The env-var feature gate has already been checked by the route.
 *
 * The loader itself does NOT consult NODE_ENV or the env var — it loads
 * whatever is asked of it. Gate logic stays in the route so the loader
 * remains a pure data primitive.
 */
export async function loadTemplate(
  organizationId: string,
  industryId: IndustryId,
  options: LoadTemplateOptions = {}
): Promise<LoadTemplateResult> {
  const template = TEMPLATES[industryId];
  if (template === undefined) {
    throw new TemplateLoaderInputError(
      "unknown_industry",
      `No template registered for industry id '${industryId}'`
    );
  }

  const selected = options.selectedItemIds;
  const isSelected = (id: string): boolean =>
    selected === undefined || selected.has(id);

  const selectedVendors      = template.vendors.filter((v) => isSelected(v.id));
  const selectedObligations  = template.obligations.filter((o) => isSelected(o.id));
  const selectedControls     = template.controls.filter((c) => isSelected(c.id));
  const selectedAiSystems    = template.ai_systems.filter((a) => isSelected(a.id));
  const selectedCount =
    selectedVendors.length +
    selectedObligations.length +
    selectedControls.length +
    selectedAiSystems.length;

  // Distinct frameworks needed to wire newly-inserted controls. Computed
  // up front so the framework upsert pass touches each (org, framework)
  // exactly once.
  const distinctFrameworks: FrameworkRef[] = Array.from(
    new Set(selectedControls.map((c) => c.framework_ref))
  );

  const client = await pg.connect();
  let inserted = { vendors: 0, ai_systems: 0, obligations: 0, controls: 0 };
  let skipped  = { vendors: 0, ai_systems: 0, obligations: 0, controls: 0 };

  try {
    await client.query("BEGIN");

    // ─── 1. Vendors ─────────────────────────────────────────────────
    for (const v of selectedVendors) {
      const flagsJson =
        v.flags !== undefined ? JSON.stringify({ flags: v.flags }) : null;
      const result = await client.query(
        `INSERT INTO vendors (
           organization_id, name, criticality, category,
           service_description, template_source, template_metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id, name) DO NOTHING
         RETURNING id`,
        [organizationId, v.name, v.criticality, v.category, v.description, industryId, flagsJson]
      );
      if ((result.rowCount ?? 0) > 0) inserted.vendors += 1;
      else skipped.vendors += 1;
    }

    // ─── 2. AI systems ──────────────────────────────────────────────
    // v1 templates carry empty ai_systems[]. Loop is in place for the
    // future; counts always 0/0 until a template populates the array.
    for (const a of selectedAiSystems) {
      const result = await client.query(
        `INSERT INTO ai_systems (
           organization_id, name, use_case, criticality,
           data_classification, template_source
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, name) DO NOTHING
         RETURNING id`,
        [
          organizationId,
          a.name,
          a.use_case,
          a.criticality,
          a.data_classification ?? null,
          industryId,
        ]
      );
      if ((result.rowCount ?? 0) > 0) inserted.ai_systems += 1;
      else skipped.ai_systems += 1;
    }

    // ─── 3. Obligations ─────────────────────────────────────────────
    for (const o of selectedObligations) {
      const result = await client.query(
        `INSERT INTO obligations (
           organization_id, title, description, jurisdiction,
           priority, template_source
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, title) DO NOTHING
         RETURNING id`,
        [
          organizationId,
          o.regulation_name,
          o.description,
          o.jurisdiction,
          o.priority,
          industryId,
        ]
      );
      if ((result.rowCount ?? 0) > 0) inserted.obligations += 1;
      else skipped.obligations += 1;
    }

    // ─── 4. Frameworks (per-org upsert) + synthetic requirements ────
    // Map of framework_ref → { framework_id, requirement_id } populated
    // in this pass and consumed by the controls pass that follows.
    const frameworkResolution = new Map<
      FrameworkRef,
      { frameworkId: string; requirementId: string }
    >();

    for (const ref of distinctFrameworks) {
      const meta = FRAMEWORK_REFS[ref];
      // Closed Record — undefined means a future FrameworkRef wasn't
      // wired into FRAMEWORK_REFS. Fail closed; better than orphaning
      // controls.
      if (meta === undefined) {
        throw new TemplateLoaderInputError(
          "framework_ref_unresolved",
          `framework_ref '${ref}' has no entry in FRAMEWORK_REFS`
        );
      }

      const fwResult = await client.query<{ id: string }>(
        `INSERT INTO frameworks (organization_id, name, version)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, name, version)
         DO UPDATE SET updated_at = frameworks.updated_at
         RETURNING id`,
        [organizationId, meta.name, meta.version]
      );
      const frameworkId = fwResult.rows[0]!.id;

      // Synthetic requirement — one per (framework, template). Allows
      // the same framework to be the umbrella for controls from two
      // different templates without one template's controls displacing
      // the other in the readiness report.
      const reqRefId = `industry-template:${industryId}`;
      const reqTitle = `${template.name} template baseline`;
      const reqResult = await client.query<{ id: string }>(
        `INSERT INTO requirements (framework_id, reference_id, title)
         VALUES ($1, $2, $3)
         ON CONFLICT (framework_id, reference_id)
         DO UPDATE SET title = requirements.title
         RETURNING id`,
        [frameworkId, reqRefId, reqTitle]
      );
      const requirementId = reqResult.rows[0]!.id;

      frameworkResolution.set(ref, { frameworkId, requirementId });
    }

    // ─── 5. Controls + control_mappings ─────────────────────────────
    for (const c of selectedControls) {
      const insertControl = await client.query<{ id: string }>(
        `INSERT INTO controls (
           organization_id, name, description, template_source
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, name) DO NOTHING
         RETURNING id`,
        [organizationId, c.name, c.description, industryId]
      );

      if ((insertControl.rowCount ?? 0) > 0) {
        inserted.controls += 1;
        const resolution = frameworkResolution.get(c.framework_ref);
        if (resolution !== undefined) {
          // ON CONFLICT DO NOTHING because a manual control_mapping with
          // the same (control, requirement) pair would be a no-op anyway.
          await client.query(
            `INSERT INTO control_mappings (control_id, requirement_id)
             VALUES ($1, $2)
             ON CONFLICT (control_id, requirement_id) DO NOTHING`,
            [insertControl.rows[0]!.id, resolution.requirementId]
          );
        }
      } else {
        skipped.controls += 1;
        // Pre-existing control: do NOT add a control_mapping. See header
        // comment — retro-tagging manually-created controls is out of
        // scope for the additive-load contract.
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    logger.error(
      { event: "template_load_failed", organizationId, industryId, err },
      "Template load failed; transaction rolled back"
    );
    throw err;
  } finally {
    client.release();
  }

  const result: LoadTemplateResult = {
    industry_id: industryId,
    selected_count: selectedCount,
    inserted,
    skipped,
  };

  logger.info(
    {
      event: "template_loaded",
      organizationId,
      industryId,
      selectedCount,
      inserted,
      skipped,
    },
    "Industry template loaded"
  );

  // Audit fire-and-forget. resource_id = NULL because industry_id is a
  // slug, not a UUID; the slug rides in payload.
  writeAuditEvent({
    organizationId,
    actorApiKeyId: options.actorApiKeyId ?? null,
    actorUserId:   options.actorUserId   ?? null,
    eventType:     "industry_template.loaded",
    resourceType:  "industry_template",
    resourceId:    null,
    payload: {
      industry_id: industryId,
      selected_count: selectedCount,
      inserted_count:
        inserted.vendors + inserted.ai_systems + inserted.obligations + inserted.controls,
      skipped_count:
        skipped.vendors + skipped.ai_systems + skipped.obligations + skipped.controls,
    },
    ipAddress: options.ipAddress ?? null,
  });

  return result;
}

/**
 * True if the env var gate is set, OR the runtime is non-production.
 *
 * Used by the route layer and the dashboard banner to decide whether
 * /templates is exposed at all. Co-located with the loader so the
 * gate's truth lives next to the thing it gates.
 *
 * The flag is binary — when off, ALL templates are hidden, even those
 * with no needs_review entries. Per-template gating is a future
 * refinement; in v1 all three templates have needs_review entries
 * anyway, so the binary gate is functionally identical to per-template.
 */
export function industryTemplatesEnabled(): boolean {
  if (process.env["SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED"] === "true") return true;
  if (process.env["NODE_ENV"] !== "production") return true;
  return false;
}

/**
 * Convenience: a template is "review-blocked" if it carries any
 * needs_review:true entry. The gate above is binary; this helper
 * exists for the design-decisions doc and for a possible future
 * per-template gate.
 */
export function isTemplateReviewBlocked(templateOrId: Template | IndustryId): boolean {
  const t = typeof templateOrId === "string" ? TEMPLATES[templateOrId] : templateOrId;
  return templateHasUnreviewedEntries(t);
}

/**
 * Pure introspection of pg PoolClient type so test files can mock
 * without re-importing pg.
 */
export type { PoolClient };
