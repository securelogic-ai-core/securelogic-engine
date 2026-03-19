export async function sendFailureAlert(
  workerName: string,
  errorMessage: string
): Promise<void> {
  const alertUrl = (process.env.ALERT_WEBHOOK_URL ?? "").trim()

  if (!alertUrl) {
    console.log("ALERT_WEBHOOK_URL not set; skipping alert")
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
