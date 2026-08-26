import { Router } from "express";
// M-1 PR-2: public tokenized surface — the HMAC unsubscribe token IS the
// authorization; no session or org context exists. email_suppressions is
// SHARED-REF (app_request holds SELECT only) and subscribers rows may be
// NULL-org, so both writes belong on the elevated channel. This also fixes a
// pre-existing defect: BEGIN/COMMIT were issued through the POOL (each
// statement could land on a different connection, so the "transaction" was
// illusory) — withElevated pins one client for a real transaction.
import { withElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
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

    await withElevated(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
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

        await client.query(
          `
          UPDATE subscribers
          SET status = 'inactive'
          WHERE LOWER(email) = LOWER($1)
          `,
          [email]
        );

        await client.query("COMMIT");
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore rollback failure
        }
        throw err;
      }
    });

    return res.status(200).send("You have been unsubscribed.");
  } catch (err) {
    logger.error({ event: "unsubscribe_failed", err }, "GET /unsubscribe failed");
    return res.status(500).send("Unsubscribe failed");
  }
});

export default router;
