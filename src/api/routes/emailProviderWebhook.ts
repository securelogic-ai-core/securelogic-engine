import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { verifyWebhookSignature } from "../infra/verifyWebhookSignature.js";

const router = Router();

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email || null;
}

function normalizeEventType(value: unknown): string {
  return String(value ?? "").trim().toLowerCase() || "unknown";
}

function isSuppressionEvent(type: string): boolean {
  return type.includes("bounce") || type.includes("complaint");
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
      providerEventId
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }

    console.error("emailProviderWebhook error:", err);
    return res.status(500).json({ error: "email_provider_webhook_failed" });
  } finally {
    client.release();
  }
});

export default router;
