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
  retry_count: number | string | null
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

function toInt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function computeNextAttempt(retryCount: number): Date {
  const delayMinutes = Math.min(60, Math.max(5, retryCount * 5))
  return new Date(Date.now() + delayMinutes * 60 * 1000)
}

const smtpHost = getRequiredEnv("SMTP_HOST")
const smtpPort = Number(process.env.SMTP_PORT ?? 587)
const smtpUser = getRequiredEnv("SMTP_USER")
const smtpPass = getRequiredEnv("SMTP_PASS")
const emailFrom = getRequiredEnv("EMAIL_FROM")

const LOCK_KEY = 710002
const WORKER_NAME = "delivery-worker"
const MAX_RETRIES = 3

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

  await pg.query(`
    ALTER TABLE newsletter_deliveries
    ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0
  `)

  await pg.query(`
    ALTER TABLE newsletter_deliveries
    ADD COLUMN IF NOT EXISTS last_error TEXT
  `)

  await pg.query(`
    ALTER TABLE newsletter_deliveries
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ
  `)

  await pg.query(`
    ALTER TABLE newsletter_deliveries
    ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ
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

async function deadLetterExceededRetries(): Promise<number> {
  const result = await pg.query(
    `
    UPDATE newsletter_deliveries
    SET dead_lettered_at = NOW(),
        next_attempt_at = NULL
    WHERE status = 'failed'
      AND dead_lettered_at IS NULL
      AND retry_count >= $1
    RETURNING id
    `,
    [MAX_RETRIES]
  )

  return result.rowCount ?? 0
}

async function run(): Promise<{
  sent: number
  failed: number
  rescheduled: number
  deadLettered: number
}> {
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
      d.retry_count,
      n.title,
      n.content_html
    FROM newsletter_deliveries d
    JOIN newsletter_issues n
      ON n.id = d.issue_id
    WHERE (
      d.status = 'queued'
      OR (
        d.status = 'failed'
        AND d.dead_lettered_at IS NULL
        AND COALESCE(d.retry_count, 0) < ${MAX_RETRIES}
        AND (
          d.next_attempt_at IS NULL
          OR d.next_attempt_at <= NOW()
        )
      )
    )
    ORDER BY d.created_at ASC
    LIMIT 25
  `)

  const deliveries = deliveriesResult.rows as DeliveryRow[]

  console.log("Deliveries ready to process:", deliveries.length)

  let sent = 0
  let failed = 0
  let rescheduled = 0

  for (const delivery of deliveries) {
    const retryCount = toInt(delivery.retry_count)

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
          provider_message_id = $2,
          last_error = NULL,
          next_attempt_at = NULL
        WHERE id = $1
        `,
        [delivery.id, info.messageId ?? `smtp-${delivery.id}`]
      )

      sent++
      await sleep(650)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const newRetryCount = retryCount + 1

      console.error("Delivery send failed:", delivery.subscriber_email)
      console.error(errorMessage)

      if (newRetryCount >= MAX_RETRIES) {
        await pg.query(
          `
          UPDATE newsletter_deliveries
          SET
            status = 'failed',
            retry_count = $2,
            last_error = $3,
            next_attempt_at = NULL,
            dead_lettered_at = NOW()
          WHERE id = $1
          `,
          [delivery.id, newRetryCount, errorMessage]
        )
      } else {
        const nextAttemptAt = computeNextAttempt(newRetryCount)

        await pg.query(
          `
          UPDATE newsletter_deliveries
          SET
            status = 'failed',
            retry_count = $2,
            last_error = $3,
            next_attempt_at = $4,
            dead_lettered_at = NULL
          WHERE id = $1
          `,
          [delivery.id, newRetryCount, errorMessage, nextAttemptAt.toISOString()]
        )

        rescheduled++
      }

      failed++
      await sleep(650)
    }
  }

  const deadLettered = await deadLetterExceededRetries()

  await reconcileIssueStatuses()

  console.log("Emails delivered:", sent)
  console.log("Emails failed:", failed)
  console.log("Emails rescheduled:", rescheduled)
  console.log("Emails dead-lettered:", deadLettered)

  return { sent, failed, rescheduled, deadLettered }
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
