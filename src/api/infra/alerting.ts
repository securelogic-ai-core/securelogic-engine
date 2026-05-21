import { logger } from "./logger.js"

export async function sendFailureAlert(
  workerName: string,
  errorMessage: string
): Promise<void> {
  const alertUrl = (process.env.ALERT_WEBHOOK_URL ?? "").trim()

  if (!alertUrl) {
    logger.debug({ event: "alert_skipped", worker: workerName }, "ALERT_WEBHOOK_URL not set; skipping alert")
    return
  }

  const body = JSON.stringify({
    worker: workerName,
    error: errorMessage,
    timestamp: new Date().toISOString()
  })

  const response = await fetch(alertUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body
  })

  if (!response.ok) {
    throw new Error(`alert webhook failed with status ${response.status}`)
  }
}

/**
 * Operator security-anomaly alert. Sibling of sendFailureAlert — same
 * ALERT_WEBHOOK_URL channel — but a distinct payload shape (`type:
 * "security_alert"`) so a recipient can tell a security anomaly from a
 * worker-failure alert.
 *
 * No-op when ALERT_WEBHOOK_URL is unset (same contract as sendFailureAlert).
 * Throws on a non-2xx webhook response; callers decide whether to swallow
 * (the synchronous auth path) or log (the Tier 2 cron).
 */
export async function sendSecurityAlert(args: {
  kind: "account_locked" | "credential_stuffing" | "api_key_probing"
  summary: string
  detail?: Record<string, unknown>
}): Promise<void> {
  const alertUrl = (process.env.ALERT_WEBHOOK_URL ?? "").trim()

  if (!alertUrl) {
    logger.debug(
      { event: "security_alert_skipped", kind: args.kind },
      "ALERT_WEBHOOK_URL not set; skipping security alert"
    )
    return
  }

  const body = JSON.stringify({
    type: "security_alert",
    kind: args.kind,
    summary: args.summary,
    detail: args.detail ?? {},
    timestamp: new Date().toISOString()
  })

  const response = await fetch(alertUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body
  })

  if (!response.ok) {
    throw new Error(`security alert webhook failed with status ${response.status}`)
  }
}
