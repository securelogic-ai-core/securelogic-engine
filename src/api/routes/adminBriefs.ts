/**
 * adminBriefs.ts — Admin routes for Intelligence Brief pipeline operations.
 *
 * Routes:
 *   POST /api/admin/briefs/run-scheduler
 *     Manually triggers the weekly brief scheduler pipeline.
 *     Protected by SCHEDULER_SECRET (Authorization: Bearer <secret>).
 *     Use this to test or manually trigger a full pipeline run in production.
 *
 * AUTH
 * ----
 * This route uses its own bearer-token auth, independent of both the platform
 * API key system (X-Api-Key) and the admin panel key (X-Admin-Key).
 * The secret is read from the SCHEDULER_SECRET environment variable at
 * request time. If the variable is not set, the endpoint returns 503
 * (service not configured) rather than 401, to surface misconfiguration clearly.
 *
 * POSITION IN index.ts
 * --------------------
 * Mount as router.use("/api", adminBriefsRouter) AFTER the main admin chain
 * so the admin panel routes remain unaffected. This router handles its own
 * auth internally and must NOT be placed behind the admin middleware chain.
 */

import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../infra/logger.js";
import { runScheduler } from "../lib/briefScheduler.js";

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiter — 5 requests per minute per IP.
// Protects SCHEDULER_SECRET from brute-force enumeration.
// ---------------------------------------------------------------------------

const schedulerRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

// ---------------------------------------------------------------------------
// POST /api/admin/briefs/run-scheduler
// Manually trigger the full weekly Intelligence Brief pipeline.
// ---------------------------------------------------------------------------

router.post("/admin/briefs/run-scheduler", schedulerRateLimit, async (req, res) => {
  // Verify SCHEDULER_SECRET
  const schedulerSecret = process.env["SCHEDULER_SECRET"];

  if (!schedulerSecret) {
    logger.warn(
      { event: "scheduler_trigger_misconfigured" },
      "POST /api/admin/briefs/run-scheduler: SCHEDULER_SECRET not configured"
    );
    return res.status(503).json({
      error: "service_not_configured",
      detail: "SCHEDULER_SECRET environment variable is not set"
    });
  }

  const authHeader = req.headers["authorization"] ?? "";
  const token =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

  // Constant-time comparison to prevent timing-oracle attacks.
  // token is sliced then padded so both Buffers are always exactly
  // schedulerSecret.length bytes — timingSafeEqual throws on length mismatch.
  const tokenNormalized = token.slice(0, schedulerSecret.length).padEnd(schedulerSecret.length);
  const tokenMatches =
    token.length > 0 &&
    crypto.timingSafeEqual(
      Buffer.from(tokenNormalized),
      Buffer.from(schedulerSecret)
    );

  if (!tokenMatches) {
    logger.warn(
      { event: "scheduler_trigger_unauthorized", ip: req.ip },
      "POST /api/admin/briefs/run-scheduler: unauthorized"
    );
    return res.status(401).json({ error: "unauthorized" });
  }

  logger.info(
    { event: "scheduler_manual_trigger", ip: req.ip },
    "Intelligence Brief scheduler manually triggered"
  );

  try {
    const summary = await runScheduler();

    return res.status(200).json({
      ok: true,
      summary
    });
  } catch (err) {
    logger.error(
      { event: "scheduler_manual_trigger_failed", err },
      "POST /api/admin/briefs/run-scheduler failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
