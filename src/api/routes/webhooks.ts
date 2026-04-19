/**
 * webhooks.ts — Customer outbound webhook endpoint management
 *
 * Customers register HTTP endpoints to receive real-time events when
 * platform objects (findings, risks, vendor assessments, posture snapshots)
 * change. Each endpoint is signed with HMAC-SHA256.
 *
 * Routes:
 *   GET    /api/webhooks                       — list endpoints
 *   POST   /api/webhooks                       — create endpoint
 *   GET    /api/webhooks/:id                   — get single endpoint
 *   PATCH  /api/webhooks/:id                   — update url/description/event_types/status
 *   DELETE /api/webhooks/:id                   — delete endpoint
 *   POST   /api/webhooks/:id/test              — send test event
 *   GET    /api/webhooks/:id/deliveries        — delivery log
 */

import crypto from "crypto";
import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireNotViewer } from "../middleware/requireRole.js";
import { generateWebhookSecret, maskSecret, buildWebhookHeaders } from "../lib/webhookSigning.js";
import { deliverWebhook } from "../lib/webhookDispatcher.js";

const router = Router();

const MAX_ENDPOINTS_PER_ORG = 10;

const VALID_EVENT_TYPES = new Set([
  "*",
  "finding.created",
  "finding.updated",
  "risk.created",
  "vendor.assessed",
  "posture.snapshot_created",
  "action.created",
  "action.updated",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

// Strip secret from row — return masked hint
function safeEndpoint(row: Record<string, unknown>): Record<string, unknown> {
  const { secret, ...rest } = row;
  return {
    ...rest,
    secret_hint: maskSecret(typeof secret === "string" ? secret : ""),
  };
}

/* =========================================================
   GET /api/webhooks
   List all endpoints for the org. Secrets are masked.
   ========================================================= */

router.get(
  "/webhooks",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const result = await pg.query(
        `SELECT id, organization_id, url, secret, description, status,
                event_types, failure_count, last_success_at, last_failure_at,
                created_at, updated_at
         FROM webhook_endpoints
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [organizationId]
      );

      res.status(200).json({
        endpoints: result.rows.map(safeEndpoint),
      });
    } catch (err) {
      logger.error({ event: "webhooks_list_failed", err }, "GET /api/webhooks failed");
      res.status(500).json({ error: "webhooks_list_failed" });
    }
  }
);

/* =========================================================
   POST /api/webhooks
   Create a new endpoint. Returns the full secret once.
   ========================================================= */

router.post(
  "/webhooks",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  requireNotViewer,
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const { url, description, event_types } = req.body ?? {};

      if (!isHttpsUrl(url)) {
        res.status(400).json({ error: "url_must_be_https" });
        return;
      }

      const rawDescription = description != null ? String(description).trim() : null;

      const rawEventTypes: string[] = Array.isArray(event_types)
        ? event_types
        : ["*"];

      for (const et of rawEventTypes) {
        if (!VALID_EVENT_TYPES.has(et)) {
          res.status(400).json({
            error: "invalid_event_type",
            invalid: et,
            allowed: [...VALID_EVENT_TYPES],
          });
          return;
        }
      }

      // Enforce per-org limit
      const countResult = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM webhook_endpoints WHERE organization_id = $1`,
        [organizationId]
      );
      if (parseInt(countResult.rows[0]?.count ?? "0", 10) >= MAX_ENDPOINTS_PER_ORG) {
        res.status(422).json({ error: "max_endpoints_reached", limit: MAX_ENDPOINTS_PER_ORG });
        return;
      }

      const secret = generateWebhookSecret();

      const result = await pg.query(
        `INSERT INTO webhook_endpoints
           (organization_id, url, secret, description, event_types)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, url, secret, description, status,
                   event_types, failure_count, last_success_at, last_failure_at,
                   created_at, updated_at`,
        [organizationId, url, secret, rawDescription, rawEventTypes]
      );

      const row = result.rows[0];

      logger.info(
        { event: "webhook_endpoint_created", endpointId: row.id, organizationId },
        "Webhook endpoint created"
      );

      // Return the full secret once — never again
      res.status(201).json({
        endpoint: {
          ...safeEndpoint(row),
          secret,
        },
      });
    } catch (err) {
      logger.error({ event: "webhook_create_failed", err }, "POST /api/webhooks failed");
      res.status(500).json({ error: "webhook_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/webhooks/:id
   Get a single endpoint. Secret is masked.
   ========================================================= */

router.get(
  "/webhooks/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const id = String(req.params.id ?? "").trim();
      if (!isUuid(id)) {
        res.status(400).json({ error: "invalid_endpoint_id" });
        return;
      }

      const result = await pg.query(
        `SELECT id, organization_id, url, secret, description, status,
                event_types, failure_count, last_success_at, last_failure_at,
                created_at, updated_at
         FROM webhook_endpoints
         WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "webhook_endpoint_not_found" });
        return;
      }

      res.status(200).json({ endpoint: safeEndpoint(result.rows[0]) });
    } catch (err) {
      logger.error({ event: "webhook_get_failed", err }, "GET /api/webhooks/:id failed");
      res.status(500).json({ error: "webhook_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/webhooks/:id
   Update url, description, event_types, or status.
   Secret cannot be changed via PATCH.
   ========================================================= */

router.patch(
  "/webhooks/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  requireNotViewer,
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const id = String(req.params.id ?? "").trim();
      if (!isUuid(id)) {
        res.status(400).json({ error: "invalid_endpoint_id" });
        return;
      }

      const body = req.body ?? {};
      const updates: string[] = [];
      const values: unknown[] = [];

      if ("url" in body) {
        if (!isHttpsUrl(body.url)) {
          res.status(400).json({ error: "url_must_be_https" });
          return;
        }
        values.push(body.url);
        updates.push(`url = $${values.length}`);
      }

      if ("description" in body) {
        values.push(body.description != null ? String(body.description).trim() : null);
        updates.push(`description = $${values.length}`);
      }

      if ("event_types" in body) {
        const et: string[] = Array.isArray(body.event_types) ? body.event_types : [];
        for (const t of et) {
          if (!VALID_EVENT_TYPES.has(t)) {
            res.status(400).json({ error: "invalid_event_type", invalid: t, allowed: [...VALID_EVENT_TYPES] });
            return;
          }
        }
        values.push(et);
        updates.push(`event_types = $${values.length}`);
      }

      if ("status" in body) {
        const status = String(body.status ?? "").toLowerCase();
        if (!["active", "disabled"].includes(status)) {
          res.status(400).json({ error: "invalid_status", allowed: ["active", "disabled"] });
          return;
        }
        values.push(status);
        updates.push(`status = $${values.length}`);
      }

      if (updates.length === 0) {
        res.status(400).json({ error: "no_fields_to_update" });
        return;
      }

      updates.push(`updated_at = NOW()`);
      values.push(id, organizationId);
      const idIdx = values.length - 1;
      const orgIdx = values.length;

      const result = await pg.query(
        `UPDATE webhook_endpoints
         SET ${updates.join(", ")}
         WHERE id = $${idIdx} AND organization_id = $${orgIdx}
         RETURNING id, organization_id, url, secret, description, status,
                   event_types, failure_count, last_success_at, last_failure_at,
                   created_at, updated_at`,
        values
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "webhook_endpoint_not_found" });
        return;
      }

      res.status(200).json({ endpoint: safeEndpoint(result.rows[0]) });
    } catch (err) {
      logger.error({ event: "webhook_patch_failed", err }, "PATCH /api/webhooks/:id failed");
      res.status(500).json({ error: "webhook_patch_failed" });
    }
  }
);

/* =========================================================
   DELETE /api/webhooks/:id
   Delete endpoint. Deliveries cascade.
   ========================================================= */

router.delete(
  "/webhooks/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  requireNotViewer,
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const id = String(req.params.id ?? "").trim();
      if (!isUuid(id)) {
        res.status(400).json({ error: "invalid_endpoint_id" });
        return;
      }

      const result = await pg.query(
        `DELETE FROM webhook_endpoints WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [id, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "webhook_endpoint_not_found" });
        return;
      }

      logger.info(
        { event: "webhook_endpoint_deleted", endpointId: id, organizationId },
        "Webhook endpoint deleted"
      );

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "webhook_delete_failed", err }, "DELETE /api/webhooks/:id failed");
      res.status(500).json({ error: "webhook_delete_failed" });
    }
  }
);

/* =========================================================
   POST /api/webhooks/:id/test
   Send a test event and return the delivery result.
   ========================================================= */

router.post(
  "/webhooks/:id/test",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  requireNotViewer,
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const id = String(req.params.id ?? "").trim();
      if (!isUuid(id)) {
        res.status(400).json({ error: "invalid_endpoint_id" });
        return;
      }

      const epResult = await pg.query<{ id: string; url: string; secret: string }>(
        `SELECT id, url, secret FROM webhook_endpoints WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      if ((epResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "webhook_endpoint_not_found" });
        return;
      }

      const endpoint = epResult.rows[0]!;

      const testEvent = {
        event_type: "webhook.test",
        organization_id: organizationId as string,
        data: { message: "Test event from SecureLogic AI", timestamp: new Date().toISOString() },
      };

      const payload = JSON.stringify({
        id: crypto.randomUUID(),
        event_type: testEvent.event_type,
        created_at: new Date().toISOString(),
        data: testEvent.data,
      });

      const deliveryOutcome = await deliverWebhook(endpoint, payload, testEvent);

      // Return current delivery row for UI feedback
      const deliveryRow = await pg.query(
        `SELECT id, event_type, status, attempt_count, response_status,
                response_body, error_message, delivered_at, created_at
         FROM webhook_deliveries WHERE id = $1`,
        [deliveryOutcome.deliveryId]
      );

      res.status(200).json({ delivery: deliveryRow.rows[0] ?? null });
    } catch (err) {
      logger.error({ event: "webhook_test_failed", err }, "POST /api/webhooks/:id/test failed");
      res.status(500).json({ error: "webhook_test_failed" });
    }
  }
);

/* =========================================================
   GET /api/webhooks/:id/deliveries
   Last 50 delivery attempts for an endpoint.
   ========================================================= */

router.get(
  "/webhooks/:id/deliveries",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const id = String(req.params.id ?? "").trim();
      if (!isUuid(id)) {
        res.status(400).json({ error: "invalid_endpoint_id" });
        return;
      }

      // Verify ownership
      const epCheck = await pg.query(
        `SELECT id FROM webhook_endpoints WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      if ((epCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "webhook_endpoint_not_found" });
        return;
      }

      const result = await pg.query(
        `SELECT id, event_type, status, attempt_count, max_attempts,
                response_status, response_body, error_message,
                next_retry_at, delivered_at, created_at
         FROM webhook_deliveries
         WHERE webhook_endpoint_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [id]
      );

      res.status(200).json({ deliveries: result.rows });
    } catch (err) {
      logger.error({ event: "webhook_deliveries_failed", err }, "GET /api/webhooks/:id/deliveries failed");
      res.status(500).json({ error: "webhook_deliveries_failed" });
    }
  }
);

export default router;
