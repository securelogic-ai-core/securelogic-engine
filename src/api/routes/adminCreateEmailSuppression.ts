import { Router } from "express"
// M-1 PR-2: staff surface behind requireAdminKey — every site is a cross-org
// list-all or a by-PK read/write of platform-level (NULL-org-capable) rows, so
// the elevated owner channel is the correct disposition (A04-G1 §3 Strategy A).
// No tenant GUC exists to scope these; withTenant would return zero rows.
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js"

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

    const result = await pgElevated.query(
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
    logger.error({ event: "admin_create_email_suppression_failed", err }, "POST /admin/email-suppressions failed")
    res.status(500).json({ error: "admin_email_suppression_create_failed" })
  }
})

export default router
