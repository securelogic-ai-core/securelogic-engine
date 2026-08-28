import { Router, type Request, type Response } from "express";
// M-1 PR-2: inbound provider webhook (svix-signature-authenticated, no org
// context exists or can exist). Writes email_provider_events + suppressions —
// system-level Tier-D/owner-side tables — inside its own explicit transaction,
// so the elevated owner channel is the correct disposition.
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { verifyWebhookSignature } from "../infra/verifyWebhookSignature.js";
import {
  readEventEnvironment,
  classifyEventEnvironment,
  currentEmailEnvironment
} from "../infra/emailEnvironment.js";
import { isSuppressionEvent } from "../lib/emailEventTypes.js";
import { describeRecipient, EMAIL_PROVIDER, sanitizeProviderText } from "../infra/emailTransport.js";

const router = Router();

/**
 * The provider's message id on an inbound event. Resend puts it at
 * `data.email_id`; the historic alias `data.id` is accepted for older shapes.
 */
export function readProviderMessageId(payload: unknown): string | null {
  const data = (payload as { data?: { email_id?: unknown; id?: unknown } } | null)?.data;
  const raw = data?.email_id ?? data?.id;
  const id = typeof raw === "string" ? raw.trim() : "";
  return id || null;
}

/**
 * The failure detail a delayed / bounced event carries, with any address
 * redacted. Resend's bounce shape is `data.bounce = { type, subType, message }`.
 */
export function readEventReason(payload: unknown): {
  bounceType: string | null;
  bounceSubType: string | null;
  reason: string | null;
} {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data ?? {};
  const bounce = (data.bounce ?? null) as { type?: unknown; subType?: unknown; message?: unknown } | null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? sanitizeProviderText(v) : null);
  return {
    bounceType: str(bounce?.type),
    bounceSubType: str(bounce?.subType),
    reason: str(bounce?.message) ?? str(data.reason)
  };
}

type SendJoin = { id: string; purpose: string; organization_id: string | null; correlation_id: string | null; created_at: string };

/** Which lifecycle events describe a delivery problem — logged at warn. */
const PROBLEM_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.delivery_delayed",
  "email.failed",
  "email.suppressed"
]);

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email || null;
}

function normalizeEventType(value: unknown): string {
  return String(value ?? "").trim().toLowerCase() || "unknown";
}

router.post("/webhooks/email/resend", async (req: Request, res: Response) => {
  const client = await pgElevated.connect();

  try {
    const rawBody =
      typeof req.rawBody === "string"
        ? req.rawBody
        : "";

    const svixId = String(req.header("svix-id") ?? "").trim();
    const svixTimestamp = String(req.header("svix-timestamp") ?? "").trim();
    const svixSignature = String(req.header("svix-signature") ?? "").trim();

    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    if (
      !verifyWebhookSignature({
        rawBody,
        webhookSecret,
        svixId,
        svixTimestamp,
        svixSignature
      })
    ) {
      return res.status(401).json({ error: "invalid_webhook_signature" });
    }

    const payload = req.body ?? {};
    const eventType = normalizeEventType(payload?.type);

    const email = normalizeEmail(
      payload?.data?.to ??
      payload?.data?.email ??
      payload?.email
    );

    const providerEventId = String(
      payload?.data?.id ??
      payload?.id ??
      svixId
    ).trim();

    if (!providerEventId) {
      return res.status(400).json({ error: "provider_event_id_required" });
    }

    /* ─────────────────────────────────────────────────────────────────────
       ENVIRONMENT ISOLATION — DARK MODE (P1-2)
       ─────────────────────────────────────────────────────────────────────
       Staging, demo and production share one Resend account and one webhook
       endpoint, which points at production. So a staging bounce is delivered
       to production, passes signature verification (the secret is identical),
       and suppresses the address in PRODUCTION. The reverse hole exists too:
       staging's mirror never sees any event at all.

       Sends now carry an `environment` tag and Resend echoes it back on the
       event, so the receiver can tell whose event this is.

       THIS IS OBSERVATION ONLY. The classification is recorded and then
       IGNORED: processing continues exactly as before for every case,
       including `mismatch`. Enforcement must not be switched on until the
       telemetry below proves no legitimate production event would be dropped
       — the failure mode of getting that wrong is production silently
       ceasing to record bounces and complaints, which is worse than the leak
       it fixes. What is NOT acceptable is a mismatch passing unnoticed, which
       is why every non-match is logged at warn with both identities.
       ───────────────────────────────────────────────────────────────────── */
    const receiverEnvironment = currentEmailEnvironment();
    const senderEnvironment = readEventEnvironment(payload);
    const environmentMatch = classifyEventEnvironment(senderEnvironment, receiverEnvironment);

    const environmentTelemetry = {
      event: "email_webhook_environment",
      mode: "dark",
      // Both sides of the comparison, so a mismatch is actionable from the log
      // line alone rather than needing the payload.
      senderEnvironment: senderEnvironment ?? "absent",
      receiverEnvironment,
      classification: environmentMatch,
      eventType,
      providerEventId,
      // Deliberately NO recipient address, subject or body: this line exists to
      // prove routing, not to duplicate the message into the log.
      wouldRejectUnderEnforcement: environmentMatch !== "match"
    };

    if (environmentMatch === "match") {
      logger.debug(environmentTelemetry, "Email webhook environment matched");
    } else {
      logger.warn(
        environmentTelemetry,
        "Email webhook environment did NOT match — processed anyway (dark mode)"
      );
    }

    /* ─────────────────────────────────────────────────────────────────────
       EMAIL-OBS-1 — correlate the event back to the send that caused it.
       ─────────────────────────────────────────────────────────────────────
       The provider echoes its message id (`data.email_id`); the transport
       recorded that id in `email_sends` when the send was accepted. Joining
       here is what turns "a bounce happened" into "Brief <id> for org <id>
       bounced at <domain>". The join is read-only and best-effort: a lookup
       failure is logged and the event is processed exactly as before. The
       log line carries domain + keyed hash, never the address.
       ───────────────────────────────────────────────────────────────────── */
    const providerMessageId = readProviderMessageId(payload);
    let join: SendJoin | null = null;
    let joinError: string | null = null;
    if (providerMessageId) {
      try {
        const r = await client.query<SendJoin>(
          `SELECT id, purpose, organization_id, correlation_id, created_at
             FROM email_sends
            WHERE provider = $1 AND provider_message_id = $2
            LIMIT 1`,
          [EMAIL_PROVIDER, providerMessageId]
        );
        join = r.rows[0] ?? null;
      } catch (err) {
        joinError = err instanceof Error ? err.message : String(err);
      }
    }

    const reasonFields = readEventReason(payload);
    const providerEventLine = {
      event: "email_provider_event",
      provider: EMAIL_PROVIDER,
      eventType,
      providerEventId,
      providerMessageId,
      unmatched: join === null,
      ...(joinError ? { joinError: sanitizeProviderText(joinError) } : {}),
      sendId: join?.id ?? null,
      purpose: join?.purpose ?? null,
      orgId: join?.organization_id ?? null,
      correlationId: join?.correlation_id ?? null,
      sentAt: join?.created_at ?? null,
      environmentClassification: environmentMatch,
      ...describeRecipient(email ?? ""),
      ...reasonFields
    };
    if (PROBLEM_EVENTS.has(eventType)) {
      logger.warn(providerEventLine, "Email provider reported a delivery problem");
    } else {
      logger.info(providerEventLine, "Email provider event received");
    }

    await client.query("BEGIN");

    let inserted = false;

    try {
      const insertResult = await client.query(
        `
        INSERT INTO email_provider_events (
          provider,
          provider_event_id,
          event_type,
          email,
          payload,
          provider_message_id
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        RETURNING id
        `,
        [
          "resend",
          providerEventId,
          eventType,
          email,
          JSON.stringify(payload),
          providerMessageId
        ]
      );

      inserted = (insertResult.rowCount ?? 0) > 0;
    } catch (err: any) {
      if (err?.code === "23505") {
        await client.query("ROLLBACK");
        return res.status(200).json({
          ok: true,
          duplicate: true,
          providerEventId
        });
      }

      throw err;
    }

    if (inserted && email && isSuppressionEvent(eventType)) {
      await client.query(
        `
        INSERT INTO email_suppressions (email, reason, source)
        VALUES ($1, $2, $3)
        ON CONFLICT (email)
        DO UPDATE SET
          reason = EXCLUDED.reason,
          source = EXCLUDED.source
        `,
        [email, eventType, "provider_webhook"]
      );

      await client.query(
        `
        UPDATE subscribers
        SET status = 'inactive'
        WHERE LOWER(email) = LOWER($1)
          AND status <> 'inactive'
        `,
        [email]
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      ok: true,
      duplicate: false,
      providerEventId,
      // Surfaced so dark-mode evidence can be gathered from responses as well
      // as logs. Under enforcement this same field reports the decision.
      environment: {
        mode: "dark",
        sender: senderEnvironment ?? "absent",
        receiver: receiverEnvironment,
        classification: environmentMatch,
        processed: true
      }
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }

    logger.error({ event: "email_provider_webhook_failed", err }, "Email provider webhook handler failed");
    return res.status(500).json({ error: "email_provider_webhook_failed" });
  } finally {
    client.release();
  }
});

export default router;
