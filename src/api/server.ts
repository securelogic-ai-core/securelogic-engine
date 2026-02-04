import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";

import { validateEnv } from "./startup/validateEnv.js";
import { runSelfTest } from "./startup/selfTest.js";

import { redis } from "./infra/redis.js";
import { httpLogger } from "./infra/httpLogger.js";

import { requestId } from "./middleware/requestId.js";
import { requireApiKey } from "./middleware/requireApiKey.js";
import { resolveEntitlement } from "./middleware/resolveEntitlement.js";
import { requireRedis } from "./middleware/requireRedis.js";
import { requestAudit } from "./middleware/requestAudit.js";
import { enforceUsageCap } from "./middleware/enforceUsageCap.js";
import { requireSubscription } from "./middleware/requireSubscription.js";
import { tierRateLimit } from "./middleware/tierRateLimit.js";
import { verifyLemonWebhook } from "./middleware/verifyLemonWebhook.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { isIssue } from "./contracts/issue.schema.js";

/* =========================================================
   BOOT-TIME GUARDS (FAIL CLOSED)
   ========================================================= */

validateEnv();
runSelfTest();

/* =========================================================
   APP INIT
   ========================================================= */

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

/* =========================================================
   REQUEST CORRELATION
   ========================================================= */

app.use(requestId);

/* =========================================================
   HTTP REQUEST LOGGING
   ========================================================= */

app.use(httpLogger);

/* =========================================================
   IN-FLIGHT REQUEST TRACKING
   ========================================================= */

let activeRequests = 0;
let isDraining = false;

app.use((req, res, next) => {
  if (isDraining) {
    res.status(503).json({ error: "server_shutting_down" });
    return;
  }

  activeRequests++;

  res.on("finish", () => {
    activeRequests--;
  });

  next();
});

/* =========================================================
   WEBHOOKS (RAW BODY — MUST BE FIRST)
   ========================================================= */

app.post(
  "/webhooks/lemon",
  bodyParser.raw({ type: "application/json" }),
  (req, _res, next) => {
    (req as any).rawBody = req.body;
    next();
  },
  verifyLemonWebhook,
  (_req: Request, res: Response) => {
    res.json({ received: true });
  }
);

/* =========================================================
   GLOBAL BODY PARSER
   ========================================================= */

app.use(express.json());

/* =========================================================
   HEALTH CHECK (NO AUTH)
   ========================================================= */

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("redis_timeout")), 500)
      )
    ]);

    res.status(200).json({
      status: "ok",
      redis: "reachable"
    });
  } catch {
    res.status(503).json({
      status: "unhealthy",
      dependency: "redis",
      error: "redis_unreachable"
    });
  }
});

/* =========================================================
   🔒 API SECURITY CHAIN (ORDER IS NON-NEGOTIABLE)
   ========================================================= */

app.use("/issues", requireApiKey);
app.use("/issues", resolveEntitlement);
app.use("/issues", requireRedis);
app.use("/issues", requestAudit);
app.use("/issues", enforceUsageCap);
app.use("/issues", tierRateLimit);

/* =========================================================
   DATA DIRECTORY
   ========================================================= */

const ISSUES_DIR = path.resolve("data/issues");

/* =========================================================
   ROUTES
   ========================================================= */

app.get("/issues/latest", (_req: Request, res: Response) => {
  if (!fs.existsSync(ISSUES_DIR)) {
    res.status(404).json({ error: "No issues published" });
    return;
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
    res.status(404).json({ error: "No issues found" });
    return;
  }

  const filePath = path.join(ISSUES_DIR, files[0]);

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    res.status(500).json({
      error: "Issue file is corrupted",
      file: files[0]
    });
    return;
  }

  if (!isIssue(parsed)) {
    res.status(500).json({
      error: "Issue schema violation",
      file: files[0]
    });
    return;
  }

  res.json(parsed);
});

app.get(
  "/issues/:id",
  requireSubscription,
  (req: Request, res: Response) => {
    const file = path.join(
      ISSUES_DIR,
      `issue-${req.params.id}.json`
    );

    if (!fs.existsSync(file)) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      res.status(500).json({ error: "Issue file corrupted" });
      return;
    }

    if (!isIssue(parsed)) {
      res.status(500).json({ error: "Issue schema violation" });
      return;
    }

    res.json(parsed);
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER (MUST BE LAST)
   ========================================================= */

app.use(errorHandler);

/* =========================================================
   START SERVER
   ========================================================= */

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureLogic Issue API listening on port ${PORT}`);
});

/* =========================================================
   GRACEFUL SHUTDOWN
   ========================================================= */

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  isDraining = true;

  console.log(`🛑 Received ${signal}. Draining in-flight requests...`);

  server.close(() => {
    console.log("🚫 HTTP server stopped accepting new connections");
  });

  const drainInterval = setInterval(async () => {
    if (activeRequests === 0) {
      clearInterval(drainInterval);

      try {
        if (redis.isOpen) {
          await redis.quit();
        }
      } finally {
        process.exit(0);
      }
    }
  }, 100);

  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);