import type { Request, Response, NextFunction } from "express";

type Tier = "free" | "paid" | "admin";

export function requireSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tier = (req as any).entitlement as Tier | undefined;

  if (!tier) {
    res.status(403).json({ error: "Subscription status missing" });
    return;
  }

  if (tier === "free") {
    res.status(402).json({
      error: "Active subscription required",
      tier
    });
    return;
  }

  next();
}
