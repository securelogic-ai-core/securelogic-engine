import express from "express";
import bodyParser from "body-parser";
import { ScoringEngine } from "../engines/v2/ScoringEngine";

const app = express();

app.use((req, _res, next) => { console.log("HIT:", req.method, req.path); next(); });

/* ===== Core middleware ===== */
app.use(bodyParser.json());
app.use("/api", require("./middleware/apiKey").requireApiKey);
app.use("/api", require("./middleware/rateLimit").apiRateLimiter);

/* ===== Routes ===== */
app.post("/api/score", (req, res) => {
  try {
    const { controls, intake } = req.body;
    const result = ScoringEngine.score(controls, intake);

    recordUsage(req.apiKey ?? "anonymous", "/api/score");
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/* ===== Health ===== */
app.get("/", (_req, res) => {
  res.json({ service: "SecureLogic Engine", status: "ok" });
});

/* ===== Internal usage inspection (admin only) ===== */

app.get("/internal/usage", (req, res) => {

  const adminKey = "ent123";



  if (req.header("x-api-key") !== adminKey) {

    return res.status(403).json({ ok: false });

  }




  res.status(200).json({ ok: true, usage: getUsage() });

});

app.listen(4000, "0.0.0.0", () => {
  console.log("🔥 SecureLogic Engine API running on 0.0.0.0:4000");
});

/* ===== Internal usage inspection (admin only) ===== */
