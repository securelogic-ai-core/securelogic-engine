import "dotenv/config";

import express, { type Request, type Response } from "express";
import bodyParser from "body-parser";

import { validateEnv } from "./startup/validateEnv.js";
import { runSelfTest } from "./startup/selfTest.js";

import { ensureRedisConnected, redisReady } from "./infra/redis.js";
import { httpLogger } from "./infra/httpLogger.js";
import { verifyIssueSignature } from "./infra/verifyIssueSignature.js";
import { logger } from "./infra/logger.js";

import { requestId } from "./middleware/requestId.js";
import { requireApiKey } from "./middleware/requireApiKey.js";
import { resolveEntitlement } from "./middleware/resolveEntitlement.js";
import { requestAudit } from "./middleware/requestAudit.js";

import { enforceUsageCap } from "./middleware/enforceUsageCap.js";
import { tierRateLimit } from "./middleware/tierRateLimit.js";

import { requireSubscription } from "./middleware/requireSubscription.js";
import { verifyLemonWebhook } from "./middleware/verifyLemonWebhook.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { requireAdminKey } from "./middleware/requireAdminKey.js";
import { adminRateLimit } from "./middleware/adminRateLimit.js";
import { adminAudit } from "./middleware/adminAudit.js";

import adminEntitlementsRouter from "./routes/adminEntitlements.js";

import { isSignedIssue } from "./contracts/signedIssue.schema.js";
import type { SignedIssue } from "./contracts/signedIssue.schema.js";

import {
  getLatestIssueId,
  getIssueArtifact,
  publishIssueArtifact
} from "./infra/issueStore.js";

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
   DRAIN MODE (GRACEFUL SHUTDOWN)
   ========================================================= */

let isDraining = false;

app.use((_req, res, next) => {
  if (isDraining) {
    res.status(503).json({ error: "server_shutting_down" });
    return;
  }
  next();
});

/* =========================================================
   WEBHOOKS (RAW BODY FIRST)
   ========================================================= */

/**
 * Lemon Squeezy webhook handler
 *
 * Production requirements:
 * - verify signature (verifyLemonWebhook)
 * - parse payload
 * - extract customer API key
 * - activate entitlement in Redis
 *
 * IMPORTANT:
 * - FAIL OPEN. Webhooks should never take down the API.
 * - Always return 200 quickly if possible (avoid retries storms).
 */
app.post(
  "/webhooks/lemon",
  bodyParser.raw({ type: "application/json" }),
  (req, _res, next) => {
    (req as any).rawBody = req.body;
    next();
  },
  verifyLemonWebhook,
  async (req: Request, res: Response) => {
    /**
     * If Redis is not configured, we still accept the webhook.
     * This prevents Lemon from retrying forever and hammering us.
     */
    if (!redisReady) {
      logger.warn(
        { route: "/webhooks/lemon" },
        "Lemon webhook received but Redis is not configured (skipping entitlement write)"
      );

      res.status(200).json({ received: true, redisConfigured: false });
      return;
    }

    try {
      const rawBody = (req as any).rawBody as Buffer;

      let parsed: any;
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        logger.warn(
          { route: "/webhooks/lemon" },
          "Lemon webhook payload was not valid JSON"
        );
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      /**
       * We do NOT trust Lemon payload shape.
       * We only accept entitlement writes if we can extract a valid SecureLogic API key.
       *
       * We support multiple possible locations because Lemon payloads vary:
       * - meta.custom_data.apiKey
       * - data.attributes.custom_data.apiKey
       * - data.attributes.user_email (fallback is NOT allowed)
       */
      const apiKey =
        parsed?.meta?.custom_data?.apiKey ??
        parsed?.data?.attributes?.custom_data?.apiKey ??
        null;

      if (typeof apiKey !== "string" || apiKey.trim() === "") {
        logger.warn(
          {
            event: parsed?.meta?.event_name ?? null,
            hasCustomData: Boolean(parsed?.meta?.custom_data),
            route: "/webhooks/lemon"
          },
          "Lemon webhook missing apiKey in custom_data (ignored)"
        );

        /**
         * We still return 200 to prevent retry storms.
         * This is correct: Lemon retries will not magically add apiKey.
         */
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      /**
       * Minimal sanity check: SecureLogic keys are expected to be sl_*
       * (We do not hard-fail here — just avoid writing garbage.)
       */
      if (!apiKey.startsWith("sl_")) {
        logger.warn(
          { apiKeyPrefix: apiKey.slice(0, 6), route: "/webhooks/lemon" },
          "Lemon webhook apiKey did not match expected prefix (ignored)"
        );
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      /**
       * Determine entitlement based on event.
       *
       * NOTE:
       * Lemon events can be:
       * - subscription_created
       * - subscription_updated
       * - subscription_cancelled
       * - subscription_expired
       * - order_created
       *
       * For now: treat most events as "activate paid"
       * unless it is clearly a cancellation/expiration.
       */
      const eventName =
        parsed?.meta?.event_name ??
        parsed?.meta?.event ??
        parsed?.event_name ??
        null;

      const eventLower =
        typeof eventName === "string" ? eventName.toLowerCase() : "";

      const isCancelEvent =
        eventLower.includes("cancel") ||
        eventLower.includes("expired") ||
        eventLower.includes("refund");

      const entitlement = {
        tier: isCancelEvent ? "free" : "paid",
        activeSubscription: !isCancelEvent
      };

      const redis = await ensureRedisConnected();

      /**
       * Store entitlements as JSON string in Redis.
       *
       * This matches the existing adminEntitlementsRouter behavior.
       */
      const key = `entitlement:${apiKey}`;
      await redis.set(key, JSON.stringify(entitlement));

      logger.info(
        {
          event: "lemon_webhook_entitlement_written",
          lemonEvent: eventName ?? null,
          apiKey,
          entitlement
        },
        "Lemon webhook processed: entitlement updated"
      );

      res.status(200).json({
        received: true,
        updated: true,
        apiKey,
        entitlement
      });
    } catch (err) {
      /**
       * FAIL OPEN:
       * Webhooks should never take down the API.
       * Return 200 to prevent retry storms.
       */
      logger.warn({ err }, "Lemon webhook failed (fail-open)");
      res.status(200).json({ received: true, error: "fail_open" });
    }
  }
);

/* =========================================================
   BODY PARSER (MUST BE AFTER RAW WEBHOOKS)
   ========================================================= */

app.use(express.json());

/* =========================================================
   HEALTH CHECK (NO AUTH)
   ========================================================= */

app.get("/health", async (_req: Request, res: Response) => {
  if (!redisReady) {
    res.status(200).json({
      status: "degraded",
      dependency: "redis",
      redisConfigured: false,
      redisConnected: false
    });
    return;
  }

  try {
    const redis = await ensureRedisConnected();
    const pong = await redis.ping();

    res.status(200).json({
      status: "ok",
      redisConfigured: true,
      redisConnected: true,
      ping: pong
    });
  } catch {
    res.status(200).json({
      status: "degraded",
      dependency: "redis",
      redisConfigured: true,
      redisConnected: false
    });
  }
});

/* =========================================================
   VERSION CHECK (DEPLOY VERIFICATION)
   ========================================================= */

app.get("/version", (_req: Request, res: Response) => {
  res.status(200).json({
    commit: process.env.RENDER_GIT_COMMIT ?? "unknown",
    service: "securelogic-engine",
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   NODE_ENV CHECK (DEPLOY VERIFICATION)
   ========================================================= */

app.get("/debug/node_env", (_req: Request, res: Response) => {
  res.status(200).json({ nodeEnv: process.env.NODE_ENV ?? null });
});

/* =========================================================
   DEBUG ROUTES (DEV ONLY)
   ========================================================= */

if (process.env.NODE_ENV === "development") {
  app.get("/debug/headers", (req: Request, res: Response) => {
    res.status(200).json({
      headers: req.headers,
      authorization: req.get("authorization") ?? null,
      xSecurelogicKey: req.get("x-securelogic-key") ?? null,
      xApiKey: req.get("x-api-key") ?? null
    });
  });

  /**
   * DEV-only debug route that is NOT under /issues
   * so it does NOT get blocked by subscription middleware.
   */
  app.get("/debug/issues_key", (req: Request, res: Response) => {
    res.status(200).json({
      headers: req.headers,
      authorization: req.get("authorization") ?? null,
      xSecurelogicKey: req.get("x-securelogic-key") ?? null,
      xApiKey: req.get("x-api-key") ?? null,
      apiKeyOnReq: (req as any).apiKey ?? null,
      entitlementOnReq: (req as any).entitlement ?? null,
      activeSubscriptionOnReq: (req as any).activeSubscription ?? null
    });
  });
}

/* =========================================================
   🔒 ADMIN ROUTES
   ========================================================= */

/**
 * NOTE:
 * - /admin/issues/publish MUST exist in prod.
 * - Redis debug routes must NEVER exist in prod.
 */

/**
 * IMPORTANT:
 * We apply requireAdminKey FIRST, then adminRateLimit, then adminAudit.
 *
 * Why?
 * - If the admin key is missing/invalid, we reject immediately.
 * - We do NOT want missing keys to generate Redis writes.
 * - We want admin audit logs only for valid admin requests.
 */
app.use("/admin", requireAdminKey);
app.use("/admin", adminRateLimit);
app.use("/admin", adminAudit);

/**
 * Admin entitlements routes (MUST be in prod)
 */
app.use(adminEntitlementsRouter);

/**
 * PROD-SAFE: Admin-only debug route (works in production)
 */
app.get("/admin/debug/issues_key", (req: Request, res: Response) => {
  res.status(200).json({
    headers: req.headers,
    authorization: req.get("authorization") ?? null,
    xSecurelogicKey: req.get("x-securelogic-key") ?? null,
    xApiKey: req.get("x-api-key") ?? null,
    apiKeyOnReq: (req as any).apiKey ?? null,
    entitlementOnReq: (req as any).entitlement ?? null,
    activeSubscriptionOnReq: (req as any).activeSubscription ?? null
  });
});

/**
 * Admin-only Redis debug routes
 * DEV ONLY.
 */
if (process.env.NODE_ENV === "development") {
  app.get(
    "/admin/debug/redis/issue/latest",
    async (_req: Request, res: Response) => {
      try {
        if (!redisReady) {
          res.status(503).json({ error: "redis_not_configured" });
          return;
        }

        const redis = await ensureRedisConnected();
        const latest = await redis.get("issues:latest");

        res.status(200).json({
          latest,
          key: "issues:latest"
        });
      } catch (err) {
        console.error("❌ /admin/debug/redis/issue/latest failed:", err);
        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  app.get(
    "/admin/debug/redis/issue/:id",
    async (req: Request, res: Response) => {
      try {
        if (!redisReady) {
          res.status(503).json({ error: "redis_not_configured" });
          return;
        }

        const idNum = Number(req.params.id);

        if (!Number.isFinite(idNum) || idNum <= 0) {
          res.status(400).json({ error: "invalid_issue_id" });
          return;
        }

        const redis = await ensureRedisConnected();

        const latest = await redis.get("issues:latest");
        const raw = await redis.get(`issues:artifact:${idNum}`);

        res.status(200).json({
          latest,
          key: `issues:artifact:${idNum}`,
          raw
        });
      } catch (err) {
        console.error("❌ /admin/debug/redis/issue/:id failed:", err);
        res.status(500).json({ error: "internal_error" });
      }
    }
  );
}

app.post("/admin/issues/publish", async (req: Request, res: Response) => {
  try {
    if (!redisReady) {
      res.status(503).json({ error: "redis_not_configured" });
      return;
    }

    const redis = await ensureRedisConnected();

    const parsed = req.body as unknown;

    if (!isSignedIssue(parsed)) {
      res.status(400).json({ error: "invalid_signed_issue_artifact" });
      return;
    }

    const artifact = parsed as SignedIssue;

    if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
      res.status(400).json({ error: "issue_signature_invalid" });
      return;
    }

    const issueNumber = artifact.issue.issueNumber;

    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      res.status(400).json({ error: "invalid_issue_number" });
      return;
    }

    await publishIssueArtifact(issueNumber, JSON.stringify(artifact));

    await redis.ping();

    res.status(200).json({
      ok: true,
      published: issueNumber
    });
  } catch (err) {
    console.error("❌ /admin/issues/publish failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/* =========================================================
   DEBUG: ISSUE AUTH HEADER CHECK (DEV ONLY)
   MUST BE BEFORE /issues middleware chain
   ========================================================= */

if (process.env.NODE_ENV === "development") {
  app.get("/issues/_debug_key", (req: Request, res: Response) => {
    res.status(200).json({
      headers: req.headers,
      authorization: req.get("authorization") ?? null,
      xSecurelogicKey: req.get("x-securelogic-key") ?? null,
      xApiKey: req.get("x-api-key") ?? null,
      apiKeyOnReq: (req as any).apiKey ?? null,
      entitlementOnReq: (req as any).entitlement ?? null,
      activeSubscriptionOnReq: (req as any).activeSubscription ?? null
    });
  });
}

/* =========================================================
   🔒 AUTH CHAIN (ISSUES)
   ========================================================= */

app.use("/issues", requireApiKey);
app.use("/issues", resolveEntitlement);
app.use("/issues", tierRateLimit);
app.use("/issues", enforceUsageCap());
app.use("/issues", requestAudit);

/* =========================================================
   ROUTES
   ========================================================= */

app.get("/issues/latest", async (_req: Request, res: Response) => {
  try {
    const latestId = await getLatestIssueId();

    if (!latestId) {
      res.status(404).json({ error: "no_issues_published" });
      return;
    }

    const raw = await getIssueArtifact(latestId);

    if (!raw) {
      res.status(404).json({ error: "no_issues_published" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "issue_artifact_corrupted" });
      return;
    }

    if (!isSignedIssue(parsed)) {
      res.status(500).json({ error: "issue_artifact_invalid" });
      return;
    }

    const artifact = parsed as SignedIssue;

    if (process.env.NODE_ENV !== "development") {
      if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
        res.status(500).json({ error: "issue_signature_verification_failed" });
        return;
      }
    }

    res.status(200).json(artifact.issue);
  } catch (err) {
    console.error("❌ /issues/latest failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get(
  "/issues/:id",
  requireSubscription,
  async (req: Request, res: Response) => {
    try {
      const idNum = Number(req.params.id);

      if (!Number.isFinite(idNum) || idNum <= 0) {
        res.status(400).json({ error: "invalid_issue_id" });
        return;
      }

      const raw = await getIssueArtifact(idNum);

      if (!raw) {
        res.status(404).json({ error: "issue_not_found" });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.status(500).json({ error: "issue_artifact_corrupted" });
        return;
      }

      if (!isSignedIssue(parsed)) {
        res.status(500).json({ error: "issue_artifact_invalid" });
        return;
      }

      const artifact = parsed as SignedIssue;

      if (process.env.NODE_ENV !== "development") {
        if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
          res.status(500).json({
            error: "issue_signature_verification_failed"
          });
          return;
        }
      }

      res.status(200).json(artifact.issue);
    } catch (err) {
      console.error("❌ /issues/:id failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

/* =========================================================
   ERROR HANDLER (LAST)
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
    try {
      if (redisReady) {
        try {
          const redis = await ensureRedisConnected();
          if (redis.isOpen) await redis.quit();
        } catch {
          // ignore shutdown redis errors
        }
      }
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);