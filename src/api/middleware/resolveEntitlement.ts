import type { Request, Response, NextFunction } from "express";

export type Tier = "free" | "pro" | "admin";

type EntitlementRecord = {
  tier: Tier;
  activeSubscription: boolean;
};

const RAW = process.env.SECURELOGIC_ENTITLEMENTS ?? "{}";

let ENTITLEMENTS: Record<string, EntitlementRecord> = {};

try {
  ENTITLEMENTS = JSON.parse(RAW);
} catch {
  ENTITLEMENTS = {};
}

export function resolveEntitlement(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = (req as any).apiKey as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  const entitlement = ENTITLEMENTS[apiKey];

  if (!entitlement) {
    res.status(403).json({ error: "No entitlement assigned" });
    return;
  }

  (req as any).entitlement = entitlement;
  next();
}