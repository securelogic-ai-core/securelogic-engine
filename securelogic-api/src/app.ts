import express from "express";
import signalsRouter from "./api/routes/signals";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/signals", signalsRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SecureLogic API running on port ${PORT}`);
});
