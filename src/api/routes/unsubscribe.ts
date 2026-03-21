import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { verifyUnsubscribeToken } from "../infra/unsubscribeToken.js";

const router = Router();

router.get("/unsubscribe", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const token = String(req.query.token || "").trim();

    if (!email || !token) {
      return res.status(400).send("Invalid unsubscribe link");
    }

    if (!verifyUnsubscribeToken(email, token)) {
      return res.status(401).send("Invalid token");
    }

    await pg.query("BEGIN");

    await pg.query(
      `
      INSERT INTO email_suppressions (email, reason, source)
      VALUES ($1, $2, $3)
      ON CONFLICT (email)
      DO UPDATE SET
        reason = EXCLUDED.reason,
        source = EXCLUDED.source
      `,
      [email, "user_unsubscribed", "unsubscribe_link"]
    );

    await pg.query(
      `
      UPDATE subscribers
      SET status = 'inactive'
      WHERE LOWER(email) = LOWER($1)
      `,
      [email]
    );

    await pg.query("COMMIT");

    return res.status(200).send("You have been unsubscribed.");
  } catch (err) {
    try {
      await pg.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }

    console.error(err);
    return res.status(500).send("Unsubscribe failed");
  }
});

export default router;
