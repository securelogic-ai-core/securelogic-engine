import express from "express";
import bodyParser from "body-parser";
import { ScoringEngine } from "../engines/v2/ScoringEngine";
import scoreV3Route from "./routes/scoreV3";

const app = express();
import { requireApiKey } from "./middleware/apiKey";
app.use(bodyParser.json());
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
