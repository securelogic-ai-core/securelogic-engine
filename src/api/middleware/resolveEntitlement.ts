import type { Request, Response, NextFunction } from "express";

/**
 * resolveEntitlement
 *
 * Derives the caller's tier and activeSubscription from the api_keys DB row
 * already attached to req.apiKey by requireApiKey. No Redis lookup needed —
 * the DB is the single source of truth for entitlement level.
 *
 * Mapping from api_keys.entitlement_level to tier:
 *   premium  → paid  (active subscription)
 *   standard → paid  (active subscription)
 *   starter  → free
 *   (missing) → free
 *
 * Fail-open: if the DB row is missing or the level is unrecognised, defaults
 * to free. requireSubscription enforces the actual gate after this resolves.
 */
export function resolveEntitlement(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const apiKeyRow = (req as any).apiKey as Record<string, unknown> | undefined;

  if (!apiKeyRow) {
    // requireApiKey should have blocked already — fail-open defensively
    (req as any).entitlement = "free";
    (req as any).activeSubscription = false;
    next();
    return;
  }

  const level =
    typeof apiKeyRow.entitlement_level === "string"
      ? apiKeyRow.entitlement_level.toLowerCase()
      : "starter";

  if (level === "premium" || level === "standard") {
    (req as any).entitlement = "paid";
    (req as any).activeSubscription = true;
  } else {
    (req as any).entitlement = "free";
    (req as any).activeSubscription = false;
  }

  next();
}
