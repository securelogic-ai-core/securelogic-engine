import { Router } from "express";
// M-1 PR-2: staff surface behind requireAdminKey — every site is a cross-org
// list-all or a by-PK read/write of platform-level (NULL-org-capable) rows, so
// the elevated owner channel is the correct disposition (A04-G1 §3 Strategy A).
// No tenant GUC exists to scope these; withTenant would return zero rows.
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

router.get("/suppressions", async (_req, res) => {
  try {
    const result = await pgElevated.query(
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
