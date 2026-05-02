import type { Request, Response, NextFunction } from "express";

type EntitlementLevel = "starter" | "standard" | "professional" | "premium";

const entitlementRank: Record<EntitlementLevel, number> = {
  starter:      1,
  standard:     2, // legacy alias for professional
  professional: 2,
  premium:      4  // premium / platform / team — all map here
};

export function requireEntitlement(minimumLevel: EntitlementLevel) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as any).organizationContext as
      | { entitlementLevel: string | null }
      | undefined;

    if (!ctx) {
      // Programming error: requireEntitlement was mounted without
      // attachOrganizationContext upstream. 401 preserves the prior
      // contract for callers that may react to it.
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    const currentLevelRaw =
      typeof ctx.entitlementLevel === "string"
        ? ctx.entitlementLevel.toLowerCase()
        : "starter";

    const currentLevel: EntitlementLevel =
      currentLevelRaw === "premium" || currentLevelRaw === "platform" || currentLevelRaw === "team"
        ? "premium"
        : currentLevelRaw === "professional" || currentLevelRaw === "standard"
          ? "professional"
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
