import type { Request, Response, NextFunction } from "express";

type Tier = "free" | "paid" | "admin";

export function requireSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tier = (req as any).entitlement as Tier | undefined;
  const activeSubscription = (req as any).activeSubscription as
    | boolean
    | undefined;

  if (!tier) {
    res.status(403).json({ error: "Subscription status missing" });
    return;
  }

  // Admin always allowed
  if (tier === "admin") {
    next();
    return;
  }

  // Free tier never allowed
  if (tier === "free") {
    res.status(402).json({
      error: "Active subscription required",
      tier
    });
    return;
  }

  // Paid tier must ALSO be active
  if (!activeSubscription) {
    res.status(402).json({
      error: "Active subscription required",
      tier,
      activeSubscription: false
    });
    return;
  }

  next();
}