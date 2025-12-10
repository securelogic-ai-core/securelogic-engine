import express from "express";
import bodyParser from "body-parser";
import { ScoringEngine } from "../engines/v2/ScoringEngine";

const app = express();

/* ===== Core middleware ===== */
app.use(bodyParser.json());
app.use("/api", require("./middleware/apiKey").requireApiKey);
app.use("/api", require("./middleware/rateLimit").apiRateLimiter);

/* ===== Routes ===== */
app.post("/api/score", (req, res) => {
  try {
    const { controls, intake } = req.body;
    const result = ScoringEngine.score(controls, intake);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/* ===== Health ===== */
app.get("/", (_req, res) => {
  res.json({ service: "SecureLogic Engine", status: "ok" });
});

app.listen(4000, "0.0.0.0", () => {
  console.log("🔥 SecureLogic Engine API running on 0.0.0.0:4000");
});
