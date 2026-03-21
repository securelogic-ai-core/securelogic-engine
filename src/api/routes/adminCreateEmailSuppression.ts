import { Router } from "express"
import { pg } from "../infra/postgres.js"

const router = Router()

router.post("/email-suppressions", async (req, res) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase()
    const reason = String(req.body?.reason ?? "manual").trim()
    const source = String(req.body?.source ?? "admin").trim()

    if (!email) {
      res.status(400).json({ error: "email_required" })
      return
    }

    const result = await pg.query(
      `
      INSERT INTO email_suppressions (email, reason, source)
      VALUES ($1, $2, $3)
      ON CONFLICT (email)
      DO UPDATE SET
        reason = EXCLUDED.reason,
        source = EXCLUDED.source
      RETURNING id, email, reason, source, created_at
      `,
      [email, reason, source]
    )

    res.status(200).json({
      ok: true,
      suppression: result.rows[0] ?? null
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_email_suppression_create_failed" })
  }
})

export default router
