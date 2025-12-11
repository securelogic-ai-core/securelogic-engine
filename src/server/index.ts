import express from "express";
import bodyParser from "body-parser";
import { RunnerEngine } from "../engines/v2/RunnerEngine";

const app = express();

/* ===== Core middleware ===== */
app.use(bodyParser.json());
app.use("/api", require("./middleware/apiKey").requireApiKey);
app.use("/api", require("./middleware/rateLimit").apiRateLimiter);

/* ===== Routes ===== */
app.post("/api/score", (req, res) => {
  const engineResult = RunnerEngine.run(req.body);
  res.json({ ok: true, engineResult });
});

/* ===== Health ===== */
app.get("/", (_req, res) => {
  res.json({ service: "SecureLogic Engine", status: "ok" });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`✅ SecureLogic Engine listening on port ${PORT}`);
});

export default app;
