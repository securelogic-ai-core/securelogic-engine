import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";

import { validateEnv } from "./startup/validateEnv.js";
import { runSelfTest } from "./startup/selfTest.js";

import { redis } from "./infra/redis.js";

import { requestId } from "./middleware/requestId.js";
import { requireApiKey } from "./middleware/requireApiKey.js";
import { resolveEntitlement } from "./middleware/resolveEntitlement.js";
import { requestAudit } from "./middleware/requestAudit.js";
import { enforceUsageCap } from "./middleware/enforceUsageCap.js";
import { requireSubscription } from "./middleware/requireSubscription.js";
import { tierRateLimit } from "./middleware/tierRateLimit.js";
import { verifyLemonWebhook } from "./middleware/verifyLemonWebhook.js";

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
   REQUEST CORRELATION (PHASE 7.1)
   ========================================================= */

app.use(requestId);

/* =========================================================
   IN-FLIGHT REQUEST TRACKING (PHASE 6.2)
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
   GLOBAL MIDDLEWARE
   ========================================================= */

app.use(express.json());

/* =========================================================
   HEALTH CHECK (DEPENDENCY-AWARE — HARD GATE)
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
   API SECURITY CHAIN (ORDER IS LOCKED)
   ========================================================= */

app.use(requireApiKey);
app.use(resolveEntitlement);
app.use(requestAudit);
app.use(enforceUsageCap);
app.use(tierRateLimit);

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
    .filter((f) => f.startsWith("issue-") && f.endsWith(".json"))
    .sort((a, b) => {
      const aNum = Number(a.replace("issue-", "").replace(".json", ""));
      const bNum = Number(b.replace("issue-", "").replace(".json", ""));
      return bNum - aNum;
    });

  if (files.length === 0) {
    res.status(404).json({ error: "No issues found" });
    return;
  }

  const latest = fs.readFileSync(
    path.join(ISSUES_DIR, files[0]),
    "utf-8"
  );

  res.json(JSON.parse(latest));
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

    const data = fs.readFileSync(file, "utf-8");
    res.json(JSON.parse(data));
  }
);

/* =========================================================
   START SERVER
   ========================================================= */

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureLogic Issue API listening on port ${PORT}`);
});

/* =========================================================
   GRACEFUL SHUTDOWN + DRAIN (PHASE 6.2)
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
      console.log("✅ All in-flight requests completed");

      try {
        if (redis.isOpen) {
          await redis.quit();
          console.log("🔌 Redis connection closed");
        }
      } catch (err) {
        console.error("❌ Error closing Redis:", err);
      } finally {
        process.exit(0);
      }
    }
  }, 100);

  setTimeout(() => {
    console.error("⏱️ Forced shutdown after 10s");
    process.exit(1);
  }, 10_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);