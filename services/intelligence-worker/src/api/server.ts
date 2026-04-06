import express from "express";
import { pg } from "../../../../src/api/infra/postgres.js";
import { logger } from "../../../../src/api/infra/logger.js";
import { requestId } from "../../../../src/api/middleware/requestId.js";
import { requestAudit } from "../../../../src/api/middleware/requestAudit.js";
import { requireApiKey } from "../../../../src/api/middleware/requireApiKey.js";
import { requireEntitlement } from "../../../../src/api/middleware/requireEntitlement.js";
import { errorHandler } from "../../../../src/api/middleware/errorHandler.js";

const app = express();
app.use(express.json());
app.use(requestId);
app.use(requestAudit);

/**
 * Base routes — unauthenticated
 */
app.get("/", (_req, res) => {
  res.status(200).json({
    service: "securelogic-intelligence-api",
    status: "ok",
    endpoints: ["/health", "/intelligence", "/intelligence/latest", "/intelligence/:id"]
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * PROTECTED INTELLIGENCE ROUTES
 * Gated by API key + standard entitlement (paid tier).
 *
 * Tenant isolation: each query is scoped to the requesting org.
 * Platform issues (organization_id IS NULL) are visible to all authenticated callers.
 * Org-specific issues are only visible to the org that owns them.
 */
app.get("/intelligence", requireApiKey, requireEntitlement("standard"), async (req, res, next) => {
  try {
    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const orgId = typeof apiKey.organization_id === "string" ? apiKey.organization_id : null;

    const result = await pg.query(
      `
      SELECT id, title, status, created_at
      FROM newsletter_issues
      WHERE (organization_id IS NOT DISTINCT FROM $1 OR organization_id IS NULL)
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [orgId]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/intelligence/latest", requireApiKey, requireEntitlement("standard"), async (req, res, next) => {
  try {
    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const orgId = typeof apiKey.organization_id === "string" ? apiKey.organization_id : null;

    const result = await pg.query(
      `
      SELECT *
      FROM newsletter_issues
      WHERE (organization_id IS NOT DISTINCT FROM $1 OR organization_id IS NULL)
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get("/intelligence/:id", requireApiKey, requireEntitlement("standard"), async (req, res, next) => {
  try {
    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const orgId = typeof apiKey.organization_id === "string" ? apiKey.organization_id : null;

    const result = await pg.query(
      `
      SELECT *
      FROM newsletter_issues
      WHERE id = $1
        AND (organization_id IS NOT DISTINCT FROM $2 OR organization_id IS NULL)
      LIMIT 1
      `,
      [req.params["id"], orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Must be last — catches errors forwarded via next(err)
app.use(errorHandler);

// Default to 3001 to avoid conflicting with the main API on 3000
const PORT = Number(process.env.INTELLIGENCE_API_PORT ?? process.env.PORT ?? 3001);

app.listen(PORT, "0.0.0.0", () => {
  logger.info({ event: "intelligence_api_start", port: PORT }, "SecureLogic Intelligence API running");
});
