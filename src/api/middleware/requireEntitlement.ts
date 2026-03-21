import type { Request, Response, NextFunction } from "express";

type EntitlementLevel = "starter" | "standard" | "premium";

const entitlementRank: Record<EntitlementLevel, number> = {
  starter: 1,
  standard: 2,
  premium: 3
};

export function requireEntitlement(minimumLevel: EntitlementLevel) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = (req as any).apiKey as Record<string, unknown> | undefined;

    if (!apiKey) {
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    const currentLevelRaw =
      typeof apiKey.entitlement_level === "string"
        ? apiKey.entitlement_level.toLowerCase()
        : "starter";

    const currentLevel: EntitlementLevel =
      currentLevelRaw === "premium"
        ? "premium"
        : currentLevelRaw === "standard"
          ? "standard"
          : "starter";

    if (entitlementRank[currentLevel] < entitlementRank[minimumLevel]) {
      res.status(403).json({
        error: "insufficient_entitlement",
        required: minimumLevel,
        current: currentLevel
      });
      return;
    }

    next();
  };
}
