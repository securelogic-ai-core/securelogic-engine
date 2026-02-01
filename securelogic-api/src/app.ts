import express, { Request, Response } from "express";
import signalsRouter from "./api/routes/signals.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api/signals", signalsRouter);

app.listen(port, () => {
  console.log(`SecureLogic API listening on port ${port}`);
});