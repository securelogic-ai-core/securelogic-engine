import type { Request, Response, NextFunction } from "express";

export function attachOrganizationContext(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const apiKey = (req as any).apiKey as Record<string, unknown> | undefined;

  const organizationId =
    apiKey && typeof apiKey.organization_id === "string"
      ? apiKey.organization_id
      : null;

  const entitlementLevel =
    apiKey && typeof apiKey.entitlement_level === "string"
      ? apiKey.entitlement_level
      : null;

  (req as any).organizationContext = {
    organizationId,
    entitlementLevel
  };

  next();
}
