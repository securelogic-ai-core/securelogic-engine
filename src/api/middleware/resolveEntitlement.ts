import type { Request, Response, NextFunction } from "express";

type Tier = "free" | "paid" | "admin";

/**
 * ENV FORMAT (JSON):
 * SECURELOGIC_ENTITLEMENTS='{"key1":"free","key2":"paid","key3":"admin"}'
 */
const RAW = process.env.SECURELOGIC_ENTITLEMENTS ?? "{}";
const ENTITLEMENTS: Record<string, Tier> = JSON.parse(RAW);

export function resolveEntitlement(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 🔒 Phase 6.2: consume canonical identity ONLY
  const apiKey = (req as any).identity?.apiKey as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  const tier = ENTITLEMENTS[apiKey];

  if (!tier) {
    res.status(403).json({ error: "No entitlement assigned" });
    return;
  }

  (req as any).entitlement = tier;
  next();
}