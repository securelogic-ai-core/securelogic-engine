import express from "express";
import { Client } from "pg";
import { pg } from "../../../../src/api/infra/postgres.js";

const app = express();
app.use(express.json());

/**
 * Subscriber middleware (paid access only)
 */
async function requireSubscriber(req: any, res: any, next: any) {
  try {
    const emailHeader = req.headers["x-user-email"];
    const email =
      typeof emailHeader === "string" ? emailHeader.trim().toLowerCase() : "";

    if (!email) {
      return res.status(401).json({ error: "missing_subscriber_identity" });
    }

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();

    const result = await client.query(
      `
      SELECT id, email, status
      FROM subscribers
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    await client.end();

    if (result.rows.length === 0) {
      return res.status(403).json({ error: "subscriber_not_found" });
    }

    const subscriber = result.rows[0];

    if (subscriber.status !== "active") {
      return res.status(403).json({ error: "inactive_subscription" });
    }

    res.locals.subscriber = subscriber;

    next();
  } catch (err) {
    console.error("Subscriber check failed:", err);
    return res.status(500).json({ error: "subscriber_check_failed" });
  }
}

/**
 * Base routes
 */
app.get("/", (_req, res) => {
  res.status(200).json({
    service: "securelogic-intelligence-api",
    status: "ok",
    endpoints: ["/health", "/intelligence", "/intelligence/:id"]
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * PROTECTED INTELLIGENCE ROUTES
 */
app.get("/intelligence", requireSubscriber, async (_req, res) => {
  try {
    const result = await pg.query(
      `
      SELECT id, title, status, created_at
      FROM newsletter_issues
      ORDER BY created_at DESC
      LIMIT 10
      `
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /intelligence failed:", err);
    res.status(500).json({ error: "intelligence_list_failed" });
  }
});

app.get("/intelligence/latest", requireSubscriber, async (_req, res) => {
  try {
    const result = await pg.query(
      `
      SELECT *
      FROM newsletter_issues
      ORDER BY created_at DESC
      LIMIT 1
      `
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "issue_not_found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /intelligence/latest failed:", err);
    res.status(500).json({ error: "intelligence_latest_failed" });
  }
});

app.get("/intelligence/:id", requireSubscriber, async (req, res) => {
  try {
    const result = await pg.query(
      `
      SELECT *
      FROM newsletter_issues
      WHERE id = $1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "issue_not_found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /intelligence/:id failed:", err);
    res.status(500).json({ error: "intelligence_detail_failed" });
  }
});

/**
 * NOTE:
 * Removed /subscribe route — no free tier, no manual signups
 * Stripe will control subscriber creation going forward
 */

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log("SecureLogic Intelligence API running on port", PORT);
});