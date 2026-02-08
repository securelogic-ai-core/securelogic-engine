import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

type Tier = "free" | "paid" | "admin";

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

export function requireSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const tierRaw = (req as any).entitlement as unknown;
    const activeRaw = (req as any).activeSubscription as unknown;

    /**
     * ENTERPRISE RULE:
     * If resolveEntitlement did not attach clean values,
     * this request is not safe to continue.
     */
    if (!isTier(tierRaw) || typeof activeRaw !== "boolean") {
      logger.warn(
        {
          route: req.originalUrl,
          method: req.method
        },
        "requireSubscription: missing/invalid entitlement context (fail-closed)"
      );

      res.status(403).json({ error: "forbidden" });
      return;
    }

    const tier: Tier = tierRaw;
    const activeSubscription: boolean = activeRaw;

    /**
     * Admin always allowed.
     */
    if (tier === "admin") {
      next();
      return;
    }

    /**
     * Free is never allowed to access subscription routes.
     */
    if (tier === "free") {
      res.status(402).json({ error: "subscription_required" });
      return;
    }

    /**
     * Paid must always be active.
     */
    if (tier === "paid" && activeSubscription !== true) {
      res.status(402).json({ error: "subscription_required" });
      return;
    }

    /**
     * Paid + active = allowed.
     */
    if (tier === "paid" && activeSubscription === true) {
      next();
      return;
    }

    /**
     * Defensive default: deny.
     */
    res.status(403).json({ error: "forbidden" });
  } catch (err) {
    /**
     * FAIL CLOSED:
     * Subscription enforcement is security-critical.
     */
    logger.error(
      {
        err,
        route: req.originalUrl,
        method: req.method
      },
      "requireSubscription failed (fail-closed)"
    );

    res.status(403).json({ error: "forbidden" });
  }
}