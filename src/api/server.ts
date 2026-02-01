import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const ISSUES_DIR = path.resolve("data/issues");

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/issues/latest", (_req: Request, res: Response) => {
  if (!fs.existsSync(ISSUES_DIR)) {
    return res.status(404).json({ error: "No issues published" });
  }

  const files = fs
    .readdirSync(ISSUES_DIR)
    .filter(f => f.startsWith("issue-") && f.endsWith(".json"))
    .sort((a, b) => {
      const aNum = Number(a.replace("issue-", "").replace(".json", ""));
      const bNum = Number(b.replace("issue-", "").replace(".json", ""));
      return bNum - aNum;
    });

  if (files.length === 0) {
    return res.status(404).json({ error: "No issues found" });
  }

  const latest = fs.readFileSync(path.join(ISSUES_DIR, files[0]), "utf-8");
  res.json(JSON.parse(latest));
});

app.get("/issues/:id", (req: Request, res: Response) => {
  const file = path.join(ISSUES_DIR, `issue-${req.params.id}.json`);

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Issue not found" });
  }

  const data = fs.readFileSync(file, "utf-8");
  res.json(JSON.parse(data));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureLogic Issue API listening on port ${PORT}`);
});
