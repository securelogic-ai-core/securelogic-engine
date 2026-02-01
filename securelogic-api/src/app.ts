import express from "express";
import signalsRouter from "./api/routes/signals.js";
import trialRouter from "./api/routes/trial.js";
import adminRouter from "./api/routes/admin.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

// Middleware
app.use(express.json());

// Health checks
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/__test", (_req, res) => {
  res.json({ ok: true });
});

// Routes
app.use("/api/trial", trialRouter);
app.use("/api/admin", adminRouter);
app.use("/api/signals", signalsRouter);

// Server
app.listen(port, "0.0.0.0", () => {
  console.log(`SecureLogic API listening on port ${port}`);
});