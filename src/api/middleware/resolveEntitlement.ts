import type { Request, Response, NextFunction } from "express";

type Tier = "free" | "paid" | "admin";

const RAW = process.env.SECURELOGIC_ENTITLEMENTS ?? "{}";
const ENTITLEMENTS: Record<string, Tier> = JSON.parse(RAW);

export function resolveEntitlement(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = (req as any).identity?.apiKey;

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