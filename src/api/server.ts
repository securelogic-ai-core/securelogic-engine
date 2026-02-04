import express from "express";
import type { Request, Response } from "express";
import bodyParser from "body-parser";

import { validateEnv } from "./startup/validateEnv.js";
import { runSelfTest } from "./startup/selfTest.js";

import { redis, redisReady } from "./infra/redis.js";
import { httpLogger } from "./infra/httpLogger.js";
import { verifyIssueSignature } from "./infra/verifyIssueSignature.js";

import { requestId } from "./middleware/requestId.js";
import { requireApiKey } from "./middleware/requireApiKey.js";
import { resolveEntitlement } from "./middleware/resolveEntitlement.js";

// ⛔ infra gates TEMPORARILY DISABLED
// import { requireRedis } from "./middleware/requireRedis.js";
// import { requestAudit } from "./middleware/requestAudit.js";
// import { enforceUsageCap } from "./middleware/enforceUsageCap.js";
// import { tierRateLimit } from "./middleware/tierRateLimit.js";

import { requireSubscription } from "./middleware/requireSubscription.js";
import { verifyLemonWebhook } from "./middleware/verifyLemonWebhook.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { isSignedIssue } from "./contracts/signedIssue.schema.js";
import type { SignedIssue } from "./contracts/signedIssue.schema.js";

import { getLatestIssueId, getIssueArtifact } from "./infra/issueStore.js";

/* =========================================================
   BOOT-TIME GUARDS
   ========================================================= */

validateEnv();
runSelfTest();

/* =========================================================
   APP INIT
   ========================================================= */

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.set("trust proxy", 1);

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
  res.on("finish", () => activeRequests--);

  next();
});

/* =========================================================
   WEBHOOKS (RAW BODY FIRST)
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
   BODY PARSER
   ========================================================= */

app.use(express.json());

/* =========================================================
   HEALTH CHECK (NO AUTH)
   ========================================================= */

app.get("/health", (_req: Request, res: Response) => {
  if (!redisReady) {
    res.status(503).json({ status: "unhealthy", dependency: "redis" });
    return;
  }

  res.status(200).json({ status: "ok" });
});

/* =========================================================
   🔒 AUTH CHAIN — DEBUG SAFE
   ========================================================= */

app.use("/issues", requireApiKey);
app.use("/issues", resolveEntitlement);

// ⛔ infra gates intentionally disabled for debugging
// app.use("/issues", requireRedis);
// app.use("/issues", requestAudit);
// app.use("/issues", enforceUsageCap);
// app.use("/issues", tierRateLimit);

/* =========================================================
   ROUTES
   ========================================================= */

app.get("/issues/latest", async (_req: Request, res: Response) => {
  const latestId = await getLatestIssueId();

  if (!latestId) {
    res.status(404).json({ error: "No issues published" });
    return;
  }

  const raw = await getIssueArtifact(latestId);

  if (!raw) {
    res.status(404).json({ error: "No issues published" });
    return;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    res.status(500).json({ error: "Issue artifact corrupted" });
    return;
  }

  if (!isSignedIssue(parsed)) {
    res.status(500).json({ error: "Unsigned or invalid issue artifact" });
    return;
  }

  const artifact = parsed as SignedIssue;

  if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
    res.status(500).json({ error: "Issue signature verification failed" });
    return;
  }

  res.json(artifact.issue);
});

app.get("/issues/:id", requireSubscription, async (req: Request, res: Response) => {
  const idNum = Number(req.params.id);

  if (!Number.isFinite(idNum) || idNum <= 0) {
    res.status(400).json({ error: "Invalid issue id" });
    return;
  }

  const raw = await getIssueArtifact(idNum);

  if (!raw) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    res.status(500).json({ error: "Issue artifact corrupted" });
    return;
  }

  if (!isSignedIssue(parsed)) {
    res.status(500).json({ error: "Unsigned or invalid issue artifact" });
    return;
  }

  const artifact = parsed as SignedIssue;

  if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
    res.status(500).json({ error: "Issue signature verification failed" });
    return;
  }

  res.json(artifact.issue);
});

/* =========================================================
   ERROR HANDLER
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

const shutdown = async (signal: string) => {
  isDraining = true;
  console.log(`🛑 ${signal} received. Draining...`);

  server.close(async () => {
    if (redis.isOpen) await redis.quit();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);