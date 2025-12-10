import express from "express";
import bodyParser from "body-parser";
import { ScoringEngine } from "../engines/v2/ScoringEngine";
import scoreV3Route from "./routes/scoreV3";

const app = express();
import { requireApiKey } from "./middleware/apiKey";
app.use(bodyParser.json());
app.use("/api", require("./middleware/apiKey").requireApiKey);

app.use("/api", require("./middleware/rateLimit").apiRateLimiter);
app.use("/api", requireApiKey);
app.use("/api/score/v3", scoreV3Route);

// Public scoring endpoint
app.post("/api/score", (req, res) => {
  try {
    const { controls, intake } = req.body;
    const result = ScoringEngine.score(controls, intake);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Health check
app.get("/", (_req, res) => {
  res.json({ service: "SecureLogic Engine", status: "ok" });
});

app.listen(4000, "0.0.0.0", () => {
  console.log("🔥 SecureLogic Engine API running on 0.0.0.0:4000");
});

// Health check
app.get("/", (_req, res) => {
  res.json({ service: "SecureLogic Engine", status: "ok" });
});

// Internal usage inspection (admin only)
app.get("/internal/usage", (req, res) => {
  const adminKey = process.env.ENGINE_API_KEY;
  if (req.header("x-api-key") !== adminKey) {
    return res.status(403).json({ ok: false });
  }
  const { getUsage } = require("./telemetry/usage");
  res.json({ ok: true, usage: getUsage() });
});
