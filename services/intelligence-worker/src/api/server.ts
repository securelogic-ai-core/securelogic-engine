import express from "express";
import { addSubscriber } from "../storage/subscriberStore.js";
import { pg } from "../../../../src/api/infra/postgres.js";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).json({
    service: "securelogic-intelligence-api",
    status: "ok",
    endpoints: ["/health", "/intelligence", "/intelligence/:id", "/subscribe"]
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/intelligence", async (_req, res) => {
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

app.get("/intelligence/latest", async (_req, res) => {
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

app.get("/intelligence/:id", async (req, res) => {
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

app.post("/subscribe", async (req, res) => {
  try {
    const { email, tier } = req.body ?? {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "invalid_email" });
    }

    await addSubscriber(email, tier || "free");

    res.json({ success: true });
  } catch (err) {
    console.error("POST /subscribe failed:", err);
    res.status(500).json({ error: "subscribe_failed" });
  }
});

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log("SecureLogic Intelligence API running on port", PORT);
});