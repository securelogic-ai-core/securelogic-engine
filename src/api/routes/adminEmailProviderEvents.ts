import { Router } from "express"
import { pg } from "../infra/postgres.js"

const router = Router()

router.get("/email-provider-events", async (_req, res) => {
  try {
    const result = await pg.query(
      `
      SELECT
        id,
        provider,
        provider_event_id,
        event_type,
        email,
        created_at,
        received_at,
        payload
      FROM email_provider_events
      ORDER BY created_at DESC
      LIMIT 100
      `
    )

    res.status(200).json({
      count: result.rows.length,
      events: result.rows
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_email_provider_events_query_failed" })
  }
})

export default router
