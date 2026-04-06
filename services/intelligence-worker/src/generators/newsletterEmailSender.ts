import nodemailer from "nodemailer"
import { pg } from "../../../../src/api/infra/postgres.js"
import { logger } from "../../../../src/api/infra/logger.js"

type Delivery = {
  id: string
  issue_id: string
  subscriber_email: string
}

type Issue = {
  id: string
  title: string
  content_html: string
}

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim()
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const smtpHost = getRequiredEnv("SMTP_HOST")
const smtpPort = Number(process.env.SMTP_PORT ?? 587)
const smtpUser = getRequiredEnv("SMTP_USER")
const smtpPass = getRequiredEnv("SMTP_PASS")
const emailFrom = getRequiredEnv("EMAIL_FROM")

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: smtpUser,
    pass: smtpPass
  }
})

export async function sendNewsletterEmails(): Promise<number> {
  logger.info({ event: "email_sender_start", smtpHost, smtpPort, emailFrom }, "Newsletter email sender starting")

  await transporter.verify()
  logger.info({ event: "smtp_verified" }, "SMTP transport verified")

  let sent = 0

  const deliveriesResult = await pg.query(`
    SELECT id, issue_id, subscriber_email
    FROM newsletter_deliveries
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 50
  `)

  const deliveries: Delivery[] = deliveriesResult.rows

  logger.info({ event: "deliveries_fetched", count: deliveries.length }, "Queued deliveries found")

  const touchedIssueIds = new Set<string>()

  for (const delivery of deliveries) {
    touchedIssueIds.add(delivery.issue_id)

    try {
      const issueResult = await pg.query(
        `
        SELECT id, title, content_html
        FROM newsletter_issues
        WHERE id = $1
        LIMIT 1
        `,
        [delivery.issue_id]
      )

      const issue: Issue | undefined = issueResult.rows[0]

      if (!issue) {
        logger.warn({ event: "issue_not_found", deliveryId: delivery.id, issueId: delivery.issue_id }, "Issue not found for delivery")

        await pg.query(
          `
          UPDATE newsletter_deliveries
          SET status = 'failed'
          WHERE id = $1
          `,
          [delivery.id]
        )

        continue
      }

      logger.info({ event: "email_sending", email: delivery.subscriber_email, issueId: delivery.issue_id }, "Sending email")

      await transporter.sendMail({
        from: emailFrom,
        to: delivery.subscriber_email,
        subject: issue.title,
        html: issue.content_html
      })

      await pg.query(
        `
        UPDATE newsletter_deliveries
        SET status = 'sent', sent_at = NOW()
        WHERE id = $1
        `,
        [delivery.id]
      )

      sent++
      logger.info({ event: "email_sent", email: delivery.subscriber_email }, "Email sent")

      await sleep(650)
    } catch (err) {
      logger.error({ event: "email_send_failed", email: delivery.subscriber_email, err }, "Email send failed")

      await pg.query(
        `
        UPDATE newsletter_deliveries
        SET status = 'failed'
        WHERE id = $1
        `,
        [delivery.id]
      )

      await sleep(650)
    }
  }

  for (const issueId of touchedIssueIds) {
    const pendingResult = await pg.query(
      `
      SELECT COUNT(*)::int AS count
      FROM newsletter_deliveries
      WHERE issue_id = $1
        AND status IN ('queued', 'failed')
      `,
      [issueId]
    )

    const pendingCount = Number(pendingResult.rows[0]?.count ?? 0)

    if (pendingCount === 0) {
      await pg.query(
        `
        UPDATE newsletter_issues
        SET status = 'sent',
            updated_at = NOW()
        WHERE id = $1
          AND status = 'queued'
        `,
        [issueId]
      )

      logger.info({ event: "issue_marked_sent", issueId }, "Newsletter issue marked sent")
    } else {
      logger.info({ event: "issue_still_queued", issueId, pendingDeliveries: pendingCount }, "Newsletter issue remains queued due to unsent deliveries")
    }
  }

  logger.info({ event: "email_sender_complete", sent }, "Newsletter email sender complete")
  return sent
}
