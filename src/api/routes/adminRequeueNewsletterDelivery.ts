import { Router } from "express"
import { pg } from "../infra/postgres.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const router = Router()

router.post("/newsletter-deliveries/:id/requeue", async (req, res) => {
  try {
    const deliveryId = String(req.params.id ?? "").trim()

    if (!deliveryId) {
      res.status(400).json({ error: "delivery_id_required" })
      return
    }

    if (!UUID_RE.test(deliveryId)) {
      res.status(400).json({ error: "invalid_delivery_id" })
      return
    }

    const existing = await pg.query(
      `
      SELECT id, issue_id, subscriber_email, status, retry_count, dead_lettered_at
      FROM newsletter_deliveries
      WHERE id = $1
      LIMIT 1
      `,
      [deliveryId]
    )

    if ((existing.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "newsletter_delivery_not_found" })
      return
    }

    const result = await pg.query(
      `
      UPDATE newsletter_deliveries
      SET status = 'queued',
          retry_count = 0,
          last_error = NULL,
          next_attempt_at = NULL,
          dead_lettered_at = NULL
      WHERE id = $1
      RETURNING id, issue_id, subscriber_email, status, retry_count, dead_lettered_at
      `,
      [deliveryId]
    )

    res.status(200).json({
      ok: true,
      delivery: result.rows[0] ?? null
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_requeue_newsletter_delivery_failed" })
  }
})

export default router
