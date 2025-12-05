import express from "express";
import dotenv from "dotenv";
import { RunnerEngine } from "../engines/v2/RunnerEngine";
import { validateInput } from "../validation/validateInput";
import catalog from "../frameworks/catalog/securelogic_full.json";

dotenv.config();

const PORT = process.env.PORT || 4000;
const API_KEY = process.env.API_KEY;

const app = express();
app.use(express.json());

// ---- API KEY MIDDLEWARE ----
app.use((req, res, next) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Server missing API key" });
  }

  const headerKey = req.headers["x-api-key"];
  if (headerKey !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }

  next();
});

// ---- HEALTH CHECK ----
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "SecureLogic Engine API" });
});

// ---- ASSESS ----
app.post("/assess", (req, res) => {
  try {
    validateInput(req.body);
    const result = RunnerEngine.run(req.body, catalog);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`SecureLogic API running at http://localhost:${PORT}`);
});

