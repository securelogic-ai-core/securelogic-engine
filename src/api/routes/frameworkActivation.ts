/**
 * frameworkActivation.ts — Framework template activation convenience route
 *
 * Allows an org to activate a pre-built framework template in a single POST.
 * Uses direct DB calls (not internal HTTP) for efficiency.
 * Idempotent: safe to call multiple times for the same template.
 *
 * Routes:
 *   POST /api/frameworks/activate
 *
 * Body: { template_key: 'soc2' | 'nist_csf' | 'iso27001' | 'hipaa' }
 *
 * Returns: { framework, requirements_created: number }
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireAdminRole } from "../middleware/requireRole.js";
import { FRAMEWORK_TEMPLATES } from "../lib/frameworkTemplates.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const VALID_TEMPLATE_KEYS = new Set(Object.keys(FRAMEWORK_TEMPLATES));

router.post(
  "/frameworks/activate",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  requireAdminRole,
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const body =
      req.body != null && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const templateKey =
      typeof body["template_key"] === "string" ? body["template_key"].trim() : "";

    if (!templateKey) {
      res.status(400).json({ error: "template_key_required" });
      return;
    }

    if (!VALID_TEMPLATE_KEYS.has(templateKey)) {
      res.status(400).json({
        error: "invalid_template_key",
        allowed: [...VALID_TEMPLATE_KEYS],
      });
      return;
    }

    const template = FRAMEWORK_TEMPLATES[templateKey]!;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Upsert framework: always returns the row whether newly inserted or existing.
      // The DO UPDATE SET updated_at = ... is a no-op touch that forces RETURNING to fire.
      const frameworkResult = await client.query<{
        id: string; organization_id: string; name: string;
        version: string; created_at: string; updated_at: string;
      }>(
        `INSERT INTO frameworks (organization_id, name, version)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, name, version)
         DO UPDATE SET updated_at = frameworks.updated_at
         RETURNING id, organization_id, name, version, created_at, updated_at`,
        [organizationId, template.name, template.version]
      );

      const framework = frameworkResult.rows[0]!;

      // Batch insert requirements, skipping conflicts.
      // Build a multi-row VALUES clause dynamically.
      // RETURNING id only fires for rows that were actually inserted (ON CONFLICT DO NOTHING).
      let requirementsCreated = 0;

      if (template.requirements.length > 0) {
        const values: unknown[] = [];
        const placeholders: string[] = [];

        for (const req of template.requirements) {
          const base = values.length;
          values.push(framework.id, req.reference_id, req.title, req.description ?? null);
          placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        }

        const insertResult = await client.query(
          `INSERT INTO requirements (framework_id, reference_id, title, description)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (framework_id, reference_id) DO NOTHING
           RETURNING id`,
          values
        );

        requirementsCreated = insertResult.rowCount ?? 0;
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "framework_activated",
          organizationId,
          frameworkId: framework.id,
          templateKey,
          requirementsCreated,
        },
        "Framework template activated"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "framework.activated",
        resourceType: "framework",
        resourceId: framework.id,
        payload: { name: framework.name, template_key: templateKey },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ framework, requirements_created: requirementsCreated });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "framework_activation_failed", err },
        "POST /api/frameworks/activate failed"
      );
      res.status(500).json({ error: "framework_activation_failed" });
    } finally {
      client.release();
    }
  }
);

export default router;
