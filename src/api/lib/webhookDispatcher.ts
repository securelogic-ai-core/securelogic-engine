import crypto from "crypto";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { buildWebhookHeaders } from "./webhookSigning.js";

export interface WebhookEvent {
  event_type: string;
  organization_id: string;
  data: Record<string, unknown>;
}

export async function dispatchWebhookEvent(event: WebhookEvent): Promise<void> {
  const endpointsResult = await pg.query<{
    id: string;
    url: string;
    secret: string;
    event_types: string[];
  }>(
    `SELECT id, url, secret, event_types
     FROM webhook_endpoints
     WHERE organization_id = $1
       AND status = 'active'`,
    [event.organization_id]
  );

  const endpoints = endpointsResult.rows.filter(
    (ep) =>
      ep.event_types.includes("*") || ep.event_types.includes(event.event_type)
  );

  if (endpoints.length === 0) return;

  const payload = JSON.stringify({
    id: crypto.randomUUID(),
    event_type: event.event_type,
    created_at: new Date().toISOString(),
    data: event.data,
  });

  for (const endpoint of endpoints) {
    deliverWebhook(endpoint, payload, event).catch((err) =>
      logger.error({ err, endpoint_id: endpoint.id }, "webhook dispatch error")
    );
  }
}

export async function deliverWebhook(
  endpoint: { id: string; url: string; secret: string },
  payload: string,
  event: WebhookEvent
): Promise<{ deliveryId: string; status: string; responseStatus: number | null }> {
  const headers = buildWebhookHeaders(payload, endpoint.secret);

  const deliveryResult = await pg.query<{ id: string }>(
    `INSERT INTO webhook_deliveries
       (webhook_endpoint_id, organization_id, event_type, payload, status)
     VALUES ($1, $2, $3, $4::jsonb, 'pending')
     RETURNING id`,
    [endpoint.id, event.organization_id, event.event_type, payload]
  );

  const deliveryId = deliveryResult.rows[0]?.id;
  if (!deliveryId) return { deliveryId: "", status: "failed", responseStatus: null };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => "");

    if (response.ok) {
      await pg.query(
        `UPDATE webhook_deliveries
         SET status = 'delivered',
             attempt_count = attempt_count + 1,
             response_status = $1,
             response_body = $2,
             delivered_at = NOW()
         WHERE id = $3`,
        [response.status, responseBody.slice(0, 500), deliveryId]
      );
      await pg.query(
        `UPDATE webhook_endpoints
         SET last_success_at = NOW(), failure_count = 0
         WHERE id = $1`,
        [endpoint.id]
      );
      return { deliveryId, status: "delivered", responseStatus: response.status };
    } else {
      await scheduleRetry(
        deliveryId,
        endpoint.id,
        response.status,
        responseBody.slice(0, 500),
        `HTTP ${response.status}`
      );
      return { deliveryId, status: "retrying", responseStatus: response.status };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await scheduleRetry(deliveryId, endpoint.id, null, null, message);
    return { deliveryId, status: "failed", responseStatus: null };
  }
}

async function scheduleRetry(
  deliveryId: string,
  endpointId: string,
  responseStatus: number | null,
  responseBody: string | null,
  errorMessage: string
): Promise<void> {
  const result = await pg.query<{ attempt_count: number }>(
    `UPDATE webhook_deliveries
     SET attempt_count = attempt_count + 1,
         response_status = $1,
         response_body = $2,
         error_message = $3
     WHERE id = $4
     RETURNING attempt_count`,
    [responseStatus, responseBody, errorMessage, deliveryId]
  );
  const attempts = result.rows[0]?.attempt_count ?? 1;

  if (attempts >= 3) {
    await pg.query(
      `UPDATE webhook_deliveries SET status = 'failed' WHERE id = $1`,
      [deliveryId]
    );
    // Auto-disable endpoint after 10 consecutive failures
    await pg.query(
      `UPDATE webhook_endpoints
       SET failure_count = failure_count + 1,
           last_failure_at = NOW(),
           status = CASE WHEN failure_count >= 9 THEN 'failed' ELSE status END
       WHERE id = $1`,
      [endpointId]
    );
  } else {
    const delayMinutes = attempts === 1 ? 1 : 5;
    await pg.query(
      `UPDATE webhook_deliveries
       SET status = 'retrying',
           next_retry_at = NOW() + ($2 * INTERVAL '1 minute')
       WHERE id = $1`,
      [deliveryId, delayMinutes]
    );
  }
}
