import { Request, Response, NextFunction } from "express";
import { entitlementStore } from "../services/entitlementStore";

export function requireAuditEntitlement(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const email = req.body?.email;

  if (!email) {
    return res.status(400).json({
      error: "Email required for entitlement check",
    });
  }

  const entitlement = entitlementStore.get(email);

  if (!entitlement || entitlement.remainingRuns <= 0) {
    return res.status(402).json({
      error: "Payment required",
    });
  }

  entitlement.remainingRuns -= 1;
  entitlementStore.set(email, entitlement);

  next();
}
