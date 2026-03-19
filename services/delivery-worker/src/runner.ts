import "dotenv/config"
import nodemailer from "nodemailer"
import { pg } from "../../../src/api/infra/postgres.js"
import { withAdvisoryLock } from "../../../src/api/infra/advisoryLock.js"
import {
  startWorkerRun,
  completeWorkerRun
} from "../../../src/api/infra/workerLogger.js"
import { sendFailureAlert } from "../../../src/api/infra/alerting.js"

type DeliveryRow = {
  id: string
  organization_id: string
  issue_id: string
  subscriber_email: string
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

const LOCK_KEY = 710002
const WORKER_NAME = "delivery-worker"

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: smtpUser,
    pass: smtpPass
  }
})

async function ensureDeliveryColumns(): Promise<void> {
  await pg.query(`
    ALTER TABLE newsletter_deliveries
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ
  `)

  await pg.query(`
    ALTER TABLE newsletter_deliveries
    ADD COLUMN IF NOT EXISTS provider_message_id TEXT
  `)
}

async function reconcileIssueStatuses(): Promise<void> {
  await pg.query(`
    UPDATE newsletter_issues ni
    SET status = 'sent',
        updated_at = NOW()
    WHERE ni.status = 'queued'
      AND NOT EXISTS (
        SELECT 1
        FROM newsletter_deliveries nd
        WHERE nd.issue_id = ni.id
          AND nd.status IN ('queued', 'failed')
      )
      AND EXISTS (
        SELECT 1
        FROM newsletter_deliveries nd
        WHERE nd.issue_id = ni.id
          AND nd.status = 'sent'
      )
  `)
}

async function run(): Promise<{ sent: number; failed: number }> {
  console.log("Delivery worker starting...")
  console.log("SMTP host:", smtpHost)
  console.log("SMTP port:", smtpPort)
  console.log("EMAIL_FROM:", emailFrom)

  await ensureDeliveryColumns()
  await transporter.verify()
  console.log("SMTP transport verified")

  const deliveriesResult = await pg.query(`
    SELECT
      d.id,
      d.organization_id,
      d.issue_id,
      d.subscriber_email,
      n.title,
      n.content_html
    FROM newsletter_deliveries d
    JOIN newsletter_issues n
      ON n.id = d.issue_id
    WHERE d.status = 'queued'
    ORDER BY d.created_at ASC
    LIMIT 25
  `)

  const deliveries = deliveriesResult.rows as DeliveryRow[]

  console.log("Queued deliveries found:", deliveries.length)

  let sent = 0
  let failed = 0

  for (const delivery of deliveries) {
    try {
      console.log("Sending newsletter to:", delivery.subscriber_email)

      const info = await transporter.sendMail({
        from: emailFrom,
        to: delivery.subscriber_email,
        subject: delivery.title,
        html: delivery.content_html
      })

      await pg.query(
        `
        UPDATE newsletter_deliveries
        SET
          status = 'sent',
          sent_at = NOW(),
          provider_message_id = $2
        WHERE id = $1
        `,
        [delivery.id, info.messageId ?? `smtp-${delivery.id}`]
      )

      sent++
      await sleep(650)
    } catch (err) {
      console.error("Delivery send failed:", delivery.subscriber_email)
      console.error(err)

      await pg.query(
        `
        UPDATE newsletter_deliveries
        SET status = 'failed'
        WHERE id = $1
        `,
        [delivery.id]
      )

      failed++
      await sleep(650)
    }
  }

  await reconcileIssueStatuses()

  console.log("Emails delivered:", sent)
  console.log("Emails failed:", failed)

  return { sent, failed }
}

async function main() {
  const workerRun = await startWorkerRun(WORKER_NAME)

  try {
    const locked = await withAdvisoryLock(LOCK_KEY, run)

    if (!locked.acquired) {
      console.log("Delivery worker skipped: advisory lock already held")

      await completeWorkerRun(
        workerRun.id,
        "success",
        workerRun.started_at,
        { skipped: true }
      )

      process.exit(0)
    }

    await completeWorkerRun(
      workerRun.id,
      "success",
      workerRun.started_at,
      locked.result ?? {}
    )

    console.log(locked.result)
    process.exit(0)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.stack ?? err.message : String(err)

    console.error("Delivery worker failure:", errorMessage)

    await completeWorkerRun(
      workerRun.id,
      "failed",
      workerRun.started_at,
      { error: errorMessage }
    )

    try {
      await sendFailureAlert(WORKER_NAME, errorMessage)
    } catch (alertErr) {
      console.error("Failure alert send failed:", alertErr)
    }

    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Delivery worker bootstrap failure:", err)
  process.exit(1)
})
