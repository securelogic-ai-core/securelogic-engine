import { Router } from "express";
import { pg } from "../infra/postgres.js";

const router = Router();

router.get("/email-provider-events/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();

    if (!id) {
      return res.status(400).json({ error: "event_id_required" });
    }

    const result = await pg.query(
      `
      SELECT
        id,
        provider,
        provider_event_id,
        event_type,
        email,
        created_at,
        payload
      FROM email_provider_events
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if ((result.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: "email_provider_event_not_found" });
    }

    return res.status(200).json({
      ok: true,
      event: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "admin_email_provider_event_fetch_failed"
    });
  }
});

export default router;
