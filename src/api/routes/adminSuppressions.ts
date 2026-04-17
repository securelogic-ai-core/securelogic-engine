import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

router.get("/suppressions", async (_req, res) => {
  try {
    const result = await pg.query(
      `SELECT id, email, reason, source AS provider, created_at
       FROM email_suppressions
       ORDER BY created_at DESC`
    );

    res.status(200).json({
      count: result.rows.length,
      suppressions: result.rows
    });
  } catch (err) {
    logger.error({ event: "admin_suppressions_failed", err }, "GET /admin/suppressions failed");
    res.status(500).json({ error: "admin_suppressions_query_failed" });
  }
});

export default router;
