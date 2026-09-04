/**
 * coreAssuranceProvisioning.ts — make sure a tenant's requirement library
 * holds the SecureLogic Core Assurance Set before composition runs at >= 1.2.0.
 *
 * ── Why lazily, at composition ───────────────────────────────────────────────
 * Same reasoning as `bridgeQuestions.ts`: the moment the resolver needs the
 * sixteen objectives is the one moment that cannot be missed, and the write is
 * idempotent (framework upsert by (organization, name, version); requirement
 * insert ON CONFLICT DO NOTHING on (framework_id, reference_id)). A tenant
 * that has never composed an assessment never receives the rows, and a tenant
 * that activated the template explicitly through POST /frameworks/activate
 * gets exactly the same rows — this reuses that route's INSERT shape rather
 * than inventing a second provisioning path.
 *
 * ── What it never does ───────────────────────────────────────────────────────
 * It never edits an existing requirement row. If a tenant has changed an
 * objective's title (the requirements route allows that), the edit stands;
 * the reference id is the identity and the objective's applicability rule
 * keys on it. A future Core Assurance Set version (1.1) is a NEW framework
 * version row, never an in-place rewrite — historical questionnaires keep
 * pointing at the rows they were issued against.
 *
 * Runs on the caller's tenant connection (asTenant / withTenant); every
 * statement carries organization_id, and RLS on `frameworks` is the backstop.
 */

import type { Pool, PoolClient } from "pg";

import { FRAMEWORK_TEMPLATES } from "../frameworkTemplates.js";
import { canonicalFrameworkKeyFor } from "../controls/canonicalFrameworkIdentity.js";
import { resolveScopeTags } from "./curatedFrameworkTags.js";
import { CORE_ASSURANCE_TEMPLATE_KEY } from "./coreAssuranceSet.js";

type Queryable = Pick<Pool | PoolClient, "query">;

export type CoreAssuranceProvisioning = {
  framework_id: string;
  /** Rows newly written by THIS call. 0 on every call after the first. */
  requirements_created: number;
};

export async function ensureCoreAssuranceSet(
  db: Queryable,
  organizationId: string
): Promise<CoreAssuranceProvisioning> {
  const template = FRAMEWORK_TEMPLATES[CORE_ASSURANCE_TEMPLATE_KEY];
  if (!template) {
    // Unreachable: the template is derived from the objectives module. Kept
    // as an assertion so a refactor that drops it fails loudly, not silently.
    throw new Error("core assurance template is not registered");
  }

  const framework = await db.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version, framework_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, name, version)
     DO UPDATE SET updated_at    = frameworks.updated_at,
                   framework_key = COALESCE(frameworks.framework_key, EXCLUDED.framework_key)
     RETURNING id`,
    [
      organizationId,
      template.name,
      template.version,
      canonicalFrameworkKeyFor(template.name, template.version),
    ]
  );
  const frameworkId = framework.rows[0]!.id;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (const req of template.requirements) {
    const resolved = resolveScopeTags({
      templateKey: CORE_ASSURANCE_TEMPLATE_KEY,
      reference_id: req.reference_id,
      title: req.title,
    });
    const base = values.length;
    values.push(
      frameworkId,
      req.reference_id,
      req.title,
      req.description ?? null,
      resolved.tags,
      resolved.source
    );
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NOW())`
    );
  }

  const inserted = await db.query(
    `INSERT INTO requirements
       (framework_id, reference_id, title, description,
        scope_tags, scope_tags_source, scope_tags_at)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (framework_id, reference_id) DO NOTHING
     RETURNING id`,
    values
  );

  return { framework_id: frameworkId, requirements_created: inserted.rowCount ?? 0 };
}
