import express from "express";
import signalsRouter from "./api/routes/signals.js";

const app = express();
const port = process.env.PORT || 3000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/signals", signalsRouter);

app.listen(port, () => {
  console.log(`SecureLogic API listening on port ${port}`);
});
