import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { verifyWebhookSignature } from "../infra/verifyWebhookSignature.js";
import {
  readEventEnvironment,
  classifyEventEnvironment,
  currentEmailEnvironment
} from "../infra/emailEnvironment.js";
import { isSuppressionEvent } from "../lib/emailEventTypes.js";

const router = Router();

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email || null;
}

function normalizeEventType(value: unknown): string {
  return String(value ?? "").trim().toLowerCase() || "unknown";
}

router.post("/webhooks/email/resend", async (req: Request, res: Response) => {
  const client = await pg.connect();

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
          payload
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id
        `,
        [
          "resend",
          providerEventId,
          eventType,
          email,
          JSON.stringify(payload)
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
