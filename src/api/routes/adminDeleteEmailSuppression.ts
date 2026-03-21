import { Router } from "express"
import { pg } from "../infra/postgres.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const router = Router()

router.delete("/email-suppressions/:id", async (req, res) => {
  try {
    const suppressionId = String(req.params.id ?? "").trim()

    if (!suppressionId) {
      res.status(400).json({ error: "suppression_id_required" })
      return
    }

    if (!UUID_RE.test(suppressionId)) {
      res.status(400).json({ error: "invalid_suppression_id" })
      return
    }

    const result = await pg.query(
      `
      DELETE FROM email_suppressions
      WHERE id = $1
      RETURNING id
      `,
      [suppressionId]
    )

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "email_suppression_not_found" })
      return
    }

    res.status(200).json({
      ok: true,
      deletedSuppressionId: suppressionId
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_email_suppression_delete_failed" })
  }
})

export default router
