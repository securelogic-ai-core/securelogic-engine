import { Router } from "express"
import { pg } from "../infra/postgres.js"

const router = Router()

router.get("/dead-letter/newsletter-deliveries", async (_req, res) => {
  try {
    const result = await pg.query(
      `
      SELECT
        id,
        issue_id,
        subscriber_email,
        status,
        retry_count,
        last_error,
        dead_lettered_at,
        created_at
      FROM newsletter_deliveries
      WHERE dead_lettered_at IS NOT NULL
      ORDER BY dead_lettered_at DESC, created_at DESC
      `
    )

    res.status(200).json({
      count: result.rows.length,
      deliveries: result.rows
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_dead_letter_deliveries_query_failed" })
  }
})

export default router
