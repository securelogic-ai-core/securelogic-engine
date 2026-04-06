import { Resend } from "resend";
import { pg } from "../../../../src/api/infra/postgres.js";
import { logger } from "../../../../src/api/infra/logger.js";
import { markIssueSent } from "../storage/postgresIssueStore.js";

/* =========================================================
   CONFIG
   ========================================================= */

// Conservative rate limit — Resend free tier: 2 req/s, paid: 10 req/s
const SEND_DELAY_MS = 200;

// Max deliveries to process per pipeline run — prevents runaway on large lists
const BATCH_SIZE = 100;

/* =========================================================
   TYPES
   ========================================================= */

type QueuedDelivery = {
  id: string;
  issue_id: string;
  subscriber_email: string;
};

type IssueContent = {
  id: string;
  title: string;
  content_html: string | null;
};

export type SendNewsletterResult = {
  sent: number;
  failed: number;
  skipped: number;
};

/* =========================================================
   HELPERS
   ========================================================= */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

function getSenderAddress(): string {
  const from = process.env.NEWSLETTER_FROM_EMAIL?.trim();
  if (!from) throw new Error("NEWSLETTER_FROM_EMAIL is not set");
  return from;
}

async function fetchIssueContent(issueId: string): Promise<IssueContent | null> {
  const result = await pg.query(
    `
    SELECT id, title, content_html
    FROM newsletter_issues
    WHERE id = $1
    LIMIT 1
    `,
    [issueId]
  );

  return result.rows[0] ?? null;
}

async function fetchQueuedDeliveries(issueId: string): Promise<QueuedDelivery[]> {
  const result = await pg.query(
    `
    SELECT id, issue_id, subscriber_email
    FROM newsletter_deliveries
    WHERE issue_id = $1
      AND status   = 'queued'
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [issueId, BATCH_SIZE]
  );

  return result.rows;
}

async function markDeliverySent(deliveryId: string): Promise<void> {
  await pg.query(
    `
    UPDATE newsletter_deliveries
    SET status   = 'sent',
        sent_at  = NOW()
    WHERE id = $1
    `,
    [deliveryId]
  );
}

async function markDeliveryFailed(deliveryId: string): Promise<void> {
  await pg.query(
    `
    UPDATE newsletter_deliveries
    SET status = 'failed'
    WHERE id = $1
    `,
    [deliveryId]
  );
}

/**
 * Returns true if the issue has no remaining queued or failed deliveries,
 * meaning all deliveries succeeded and the issue can be marked sent.
 */
async function isIssueFullySent(issueId: string): Promise<boolean> {
  const result = await pg.query(
    `
    SELECT COUNT(*)::int AS remaining
    FROM newsletter_deliveries
    WHERE issue_id = $1
      AND status IN ('queued', 'failed')
    `,
    [issueId]
  );

  return Number(result.rows[0]?.remaining ?? 1) === 0;
}

/* =========================================================
   MAIN EXPORT

   Drains the newsletter_deliveries queue for the given issue.
   Suppressions are already handled by generateNewsletterDeliveries —
   only rows with status = 'queued' are processed here.

   Call this AFTER generateNewsletterDeliveries() has run so the
   delivery rows exist. The pipeline promotes draft → queued before
   delivery generation so this function always has rows to work with
   on send day.
   ========================================================= */

export async function sendNewsletter(issueId: string): Promise<SendNewsletterResult> {
  const result: SendNewsletterResult = { sent: 0, failed: 0, skipped: 0 };

  const issue = await fetchIssueContent(issueId);

  if (!issue) {
    logger.warn({ event: "newsletter_send_no_issue", issueId }, "sendNewsletter: issue not found");
    return result;
  }

  if (!issue.content_html) {
    logger.warn({ event: "newsletter_send_no_html", issueId }, "sendNewsletter: issue has no content_html — skipping send");
    return result;
  }

  const deliveries = await fetchQueuedDeliveries(issueId);

  if (deliveries.length === 0) {
    logger.info({ event: "newsletter_send_no_deliveries", issueId }, "sendNewsletter: no queued deliveries found");
    return result;
  }

  logger.info(
    { event: "newsletter_send_start", issueId, count: deliveries.length },
    `Sending newsletter to ${deliveries.length} queued recipient(s)`
  );

  let resend: Resend;
  let from: string;

  try {
    resend = getResend();
    from = getSenderAddress();
  } catch (err) {
    logger.error({ event: "newsletter_send_misconfigured", err }, "sendNewsletter: missing env vars — aborting");
    return result;
  }

  for (const delivery of deliveries) {
    try {
      await resend.emails.send({
        from,
        to: delivery.subscriber_email,
        subject: issue.title,
        html: issue.content_html
      });

      await markDeliverySent(delivery.id);
      result.sent++;

      logger.info(
        { event: "email_sent", deliveryId: delivery.id, email: delivery.subscriber_email, issueId },
        "Email sent"
      );
    } catch (err) {
      await markDeliveryFailed(delivery.id);
      result.failed++;

      logger.error(
        { event: "email_send_failed", deliveryId: delivery.id, email: delivery.subscriber_email, issueId, err },
        "Email send failed"
      );
    }

    await sleep(SEND_DELAY_MS);
  }

  // If all deliveries for this issue are now sent, promote the issue to 'sent'
  if (await isIssueFullySent(issueId)) {
    await markIssueSent(issueId);
    logger.info({ event: "issue_marked_sent", issueId }, "All deliveries complete — issue marked sent");
  } else {
    logger.info(
      { event: "issue_send_partial", issueId, sent: result.sent, failed: result.failed },
      "Issue has remaining unsent deliveries — will retry on next run"
    );
  }

  logger.info(
    { event: "newsletter_send_complete", issueId, sent: result.sent, failed: result.failed },
    "Newsletter send complete"
  );

  return result;
}
