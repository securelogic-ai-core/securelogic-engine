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
 *   POST   /api/webhooks/:id/rotate-secret     — rotate signing secret (returned once)
 *   POST   /api/webhooks/:id/test              — send test event
 *   GET    /api/webhooks/:id/deliveries        — delivery log
 */

import crypto from "crypto";
import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireNotViewer } from "../middleware/requireRole.js";
import { generateWebhookSecret, maskSecret, buildWebhookHeaders } from "../lib/webhookSigning.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { deliverWebhook } from "../lib/webhookDispatcher.js";
import {
  assertSafeWebhookUrl,
  UnsafeWebhookUrlError,
} from "../lib/webhookUrlSafety.js";
import {
  webhookEventCatalog,
  webhookEventTypes,
} from "../lib/webhookEventCatalog.js";

const router = Router();

const MAX_ENDPOINTS_PER_ORG = 10;

/** The wildcard is a subscription shape, not a catalog entry. */
const WILDCARD_EVENT_TYPE = "*";

/**
 * Event-type validation reads the canonical catalog
 * (lib/webhookEventCatalog.ts) at call time, so the types this route accepts,
 * the types the catalog endpoint advertises, and the types the settings UI
 * offers cannot drift apart. The catalog is itself wave-1-flag-aware: flag-off,
 * the wave-1 names are absent, so this route stays byte-identical to
 * pre-wave-1 (new names rejected, never revealed in `allowed`).
 */
function isValidEventType(t: string): boolean {
  return t === WILDCARD_EVENT_TYPE || webhookEventTypes().includes(t);
}

function allowedEventTypes(): string[] {
  return [WILDCARD_EVENT_TYPE, ...webhookEventTypes()];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/**
 * Maps an UnsafeWebhookUrlError to a customer-facing 400 body. The reason
 * field is machine-readable; the message is the prose the webhook-config UI
 * should surface.
 */
function urlSafetyErrorResponse(err: UnsafeWebhookUrlError): {
  error: string;
  reason: string;
  detail?: string;
  message: string;
} {
  const withDetail = (message: string) =>
    err.detail !== undefined
      ? { error: "url_unsafe", reason: err.reason, detail: err.detail, message }
      : { error: "url_unsafe", reason: err.reason, message };

  switch (err.reason) {
    case "invalid_url":
      return withDetail("URL is not a valid URL.");
    case "not_https":
      return withDetail("URL must use https://. Plain http and other schemes are not accepted.");
    case "blocked_hostname":
      return withDetail(
        "Hostname is blocked (loopback, cloud metadata service, or similar). Only public-internet HTTPS endpoints are accepted."
      );
    case "blocked_ip_range":
      return withDetail(
        "URL resolved to a private/loopback IP, only public-internet HTTPS endpoints are accepted."
      );
    case "dns_resolution_failed":
      return withDetail(
        "Could not resolve hostname. Confirm the URL is reachable from the public internet."
      );
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
  requireEntitlement("premium"),
  denyContributor(),
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
  requireEntitlement("premium"),
  denyContributor(),
  requireNotViewer,
  async (req, res) => {
    try {
      const organizationId = (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const { url, description, event_types } = req.body ?? {};

      if (typeof url !== "string") {
        res.status(400).json({ error: "url_required" });
        return;
      }
      try {
        await assertSafeWebhookUrl(url);
      } catch (err) {
        if (err instanceof UnsafeWebhookUrlError) {
          res.status(400).json(urlSafetyErrorResponse(err));
          return;
        }
        throw err;
      }

      const rawDescription = description != null ? String(description).trim() : null;

      const rawEventTypes: string[] = Array.isArray(event_types)
        ? event_types
        : ["*"];

      for (const et of rawEventTypes) {
        if (!isValidEventType(et)) {
          res.status(400).json({
            error: "invalid_event_type",
            invalid: et,
            allowed: allowedEventTypes(),
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
   GET /api/webhooks/event-types
   The event catalog this deployment currently accepts.
   ========================================================= */

/**
 * ROUTE ORDER: this MUST stay above GET /webhooks/:id — Express would
 * otherwise bind the literal path as :id and answer with a 404 for a
 * webhook whose id is "event-types" (the same trap the register export
 * routers document against their own /:id routes).
 *
 * Org-scoped only in the entitlement sense: the catalog is deployment-wide
 * (no tenant rows are read), but it stays behind the same premium gate as the
 * rest of the family so it cannot be used to fingerprint feature-flag state
 * from an unentitled account.
 */
router.get(
  "/webhooks/event-types",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  async (_req, res) => {
    res.status(200).json({ event_types: webhookEventCatalog() });
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
  requireEntitlement("premium"),
  denyContributor(),
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
  requireEntitlement("premium"),
  denyContributor(),
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
        if (typeof body.url !== "string") {
          res.status(400).json({ error: "url_required" });
          return;
        }
        try {
          await assertSafeWebhookUrl(body.url);
        } catch (err) {
          if (err instanceof UnsafeWebhookUrlError) {
            res.status(400).json(urlSafetyErrorResponse(err));
            return;
          }
          throw err;
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
          if (!isValidEventType(t)) {
            res.status(400).json({ error: "invalid_event_type", invalid: t, allowed: allowedEventTypes() });
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
  requireEntitlement("premium"),
  denyContributor(),
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
   POST /api/webhooks/:id/rotate-secret
   Rotate the endpoint's HMAC signing secret in place.

   Before this route the only way to rotate a compromised or aging secret
   was delete + recreate — destroying the delivery log, failure counters,
   and event-type configuration. Rotation is a plain org-scoped UPDATE:
   the endpoint's identity and history survive, and the new secret is
   returned ONCE (the create-route contract; masked everywhere after).

   Cutover is immediate: deliveries signed after the UPDATE use the new
   secret. The caller controls timing — rotate when ready to deploy the
   new secret on the receiving side; the dispatcher's existing retry
   path covers the deploy gap. A dual-secret overlap window would need
   schema + dispatcher signing changes and is deliberately out of scope.
   ========================================================= */

router.post(
  "/webhooks/:id/rotate-secret",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
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

      const secret = generateWebhookSecret();

      const result = await pg.query(
        `UPDATE webhook_endpoints
            SET secret = $1, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3
          RETURNING id, organization_id, url, secret, description, status,
                    event_types, failure_count, last_success_at, last_failure_at,
                    created_at, updated_at`,
        [secret, id, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "webhook_endpoint_not_found" });
        return;
      }

      const row = result.rows[0];

      // Rotation is the security event on this surface — auditors expect it
      // in the org trail with actor + timestamp. The secret itself (old or
      // new) never appears in the audit payload.
      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: (req as any).userId ?? null,
        eventType: "webhook.secret_rotated",
        resourceType: "webhook_endpoint",
        resourceId: id,
        payload: { url: row.url },
        ipAddress: req.ip ?? null,
      });

      logger.info(
        { event: "webhook_secret_rotated", endpointId: id, organizationId },
        "Webhook endpoint signing secret rotated"
      );

      // Return the full secret once — never again (create-route contract).
      res.status(200).json({
        endpoint: {
          ...safeEndpoint(row),
          secret,
        },
      });
    } catch (err) {
      logger.error(
        { event: "webhook_rotate_secret_failed", err },
        "POST /api/webhooks/:id/rotate-secret failed"
      );
      res.status(500).json({ error: "webhook_rotate_secret_failed" });
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
  requireEntitlement("premium"),
  denyContributor(),
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
  requireEntitlement("premium"),
  denyContributor(),
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
