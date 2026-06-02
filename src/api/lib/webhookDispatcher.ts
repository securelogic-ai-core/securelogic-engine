/**
 * webhookDispatcher.ts — outbound webhook fan-out and delivery bookkeeping.
 *
 * RLS adoption (A04-G1 PR β1): all DB access goes through `pgElevated` (the
 * owner pool, outside any tenant scope), NOT the ambient `pg` proxy. The
 * dispatcher runs as fire-and-forget continuations — `dispatchWebhookEvent`
 * fans out to `deliverWebhook(...)` per endpoint WITHOUT awaiting (preserving
 * the best-effort, off-request-path delivery contract), and the callers
 * (`findings`/`risks`/`posture`/`vendorAssessments` write routes) invoke it
 * without awaiting. Once those routes are wrapped in `asTenant()` (β2+), an
 * ambient `pg.query()` here would execute AFTER the request transaction has
 * committed and released its tenant client — a use-after-release on the pooled
 * connection. `pgElevated` is a separate pool whose `.query()` bypasses the
 * proxy and the tenant AsyncLocalStorage entirely, so the dispatcher's
 * connection lifecycle is wholly independent of any caller's request scope.
 *
 * This mirrors the established `auditLog.ts` pattern (writeAuditEvent →
 * pgElevated). Both `webhook_endpoints` and `webhook_deliveries` are
 * CUSTOMER-DATA; isolation on this owner channel is provided by every query
 * filtering/writing `organization_id` explicitly (the event payload carries
 * it), consistent with the existing owner-path enumeration in
 * `startupCheck.ts`. See docs/A04-G1-pr-beta-design.md (Option 2).
 */

import crypto from "crypto";
import { fetch as undiciFetch } from "undici";
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { buildWebhookHeaders } from "./webhookSigning.js";
import {
  assertSafeWebhookUrl,
  buildPinnedAgent,
  UnsafeWebhookUrlError,
} from "./webhookUrlSafety.js";

export interface WebhookEvent {
  event_type: string;
  organization_id: string;
  data: Record<string, unknown>;
}

export async function dispatchWebhookEvent(event: WebhookEvent): Promise<void> {
  const endpointsResult = await pgElevated.query<{
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

  const deliveryResult = await pgElevated.query<{ id: string }>(
    `INSERT INTO webhook_deliveries
       (webhook_endpoint_id, organization_id, event_type, payload, status)
     VALUES ($1, $2, $3, $4::jsonb, 'pending')
     RETURNING id`,
    [endpoint.id, event.organization_id, event.event_type, payload]
  );

  const deliveryId = deliveryResult.rows[0]?.id;
  if (!deliveryId) return { deliveryId: "", status: "failed", responseStatus: null };

  // SSRF defense (A10-G1): re-validate the URL at delivery time, which
  // re-resolves DNS. The returned IP is then pinned via the undici Agent's
  // connect.lookup hook, so the TCP connection goes to the IP we approved —
  // closing the DNS rebinding window between validation and connect().
  let safeTarget;
  try {
    safeTarget = await assertSafeWebhookUrl(endpoint.url);
  } catch (err) {
    if (err instanceof UnsafeWebhookUrlError) {
      const message = `unsafe_url:${err.reason}${err.detail ? `:${err.detail}` : ""}`;
      logger.warn(
        {
          event: "webhook_delivery_blocked_unsafe_url",
          endpoint_id: endpoint.id,
          reason: err.reason,
          detail: err.detail,
        },
        "webhookDispatcher: refused to dispatch — URL failed safety check"
      );
      await scheduleRetry(deliveryId, endpoint.id, null, null, message);
      return { deliveryId, status: "failed", responseStatus: null };
    }
    throw err;
  }

  const agent = buildPinnedAgent(safeTarget.ip, safeTarget.family);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await undiciFetch(endpoint.url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
      redirect: "manual",
      dispatcher: agent,
    });
    clearTimeout(timeout);

    // 3xx with redirect:"manual" is terminal — treat as a delivery failure
    // so customers can't chain through a public redirector to reach a
    // blocked target. Do not read or persist the redirect body.
    if (response.status >= 300 && response.status < 400) {
      await scheduleRetry(deliveryId, endpoint.id, response.status, null, "redirect_blocked");
      return { deliveryId, status: "retrying", responseStatus: response.status };
    }

    if (response.ok) {
      const responseBody = await response.text().catch(() => "");
      await pgElevated.query(
        `UPDATE webhook_deliveries
         SET status = 'delivered',
             attempt_count = attempt_count + 1,
             response_status = $1,
             response_body = $2,
             delivered_at = NOW()
         WHERE id = $3`,
        [response.status, responseBody.slice(0, 500), deliveryId]
      );
      await pgElevated.query(
        `UPDATE webhook_endpoints
         SET last_success_at = NOW(), failure_count = 0
         WHERE id = $1`,
        [endpoint.id]
      );
      return { deliveryId, status: "delivered", responseStatus: response.status };
    } else {
      // Non-2xx (A10-G1 Layer C): do NOT persist response_body. The body was
      // previously stored and surfaced via GET /api/webhooks/:id/deliveries,
      // which turned every SSRF probe into a side-channel oracle.
      await scheduleRetry(
        deliveryId,
        endpoint.id,
        response.status,
        null,
        `HTTP ${response.status}`
      );
      return { deliveryId, status: "retrying", responseStatus: response.status };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await scheduleRetry(deliveryId, endpoint.id, null, null, message);
    return { deliveryId, status: "failed", responseStatus: null };
  } finally {
    await agent.close().catch(() => undefined);
  }
}

async function scheduleRetry(
  deliveryId: string,
  endpointId: string,
  responseStatus: number | null,
  responseBody: string | null,
  errorMessage: string
): Promise<void> {
  const result = await pgElevated.query<{ attempt_count: number }>(
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
    await pgElevated.query(
      `UPDATE webhook_deliveries SET status = 'failed' WHERE id = $1`,
      [deliveryId]
    );
    // Auto-disable endpoint after 10 consecutive failures
    await pgElevated.query(
      `UPDATE webhook_endpoints
       SET failure_count = failure_count + 1,
           last_failure_at = NOW(),
           status = CASE WHEN failure_count >= 9 THEN 'failed' ELSE status END
       WHERE id = $1`,
      [endpointId]
    );
  } else {
    const delayMinutes = attempts === 1 ? 1 : 5;
    await pgElevated.query(
      `UPDATE webhook_deliveries
       SET status = 'retrying',
           next_retry_at = NOW() + ($2 * INTERVAL '1 minute')
       WHERE id = $1`,
      [deliveryId, delayMinutes]
    );
  }
}
