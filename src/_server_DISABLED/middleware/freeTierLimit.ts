import { Request, Response, NextFunction } from "express";

const FREE_TIER_LIMIT = 1;

/**
 * In-memory counter keyed by email
 * (dev-safe, resets on server restart)
 */
const freeTierUsage = new Map<string, number>();

export function freeTierAuditLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const email = req.body?.email;

  if (!email) {
    return res.status(400).json({ error: "EMAIL_REQUIRED" });
  }

  const used = freeTierUsage.get(email) ?? 0;

  if (used >= FREE_TIER_LIMIT) {
    return res.status(403).json({
      error: "FreeTierLimitReached",
      message: "Free tier is limited to 1 AI Audit Sprint"
    });
  }

  freeTierUsage.set(email, used + 1);
  next();
}

/**
 * DEV ONLY — resets all free-tier usage
 */
export function resetFreeTier() {
  freeTierUsage.clear();
}