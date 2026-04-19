import type { Request, Response, NextFunction } from "express";

/**
 * requireRole — gate a route to specific user roles.
 *
 * Only applies when the request was authenticated via JWT (req.userRole is set).
 * API key auth (non-JWT) bypasses role checks — API keys are admin-level.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.userRole ?? (req as any).jwtPayload?.role;

    // No role means API key auth — bypass role checks
    if (!role) {
      next();
      return;
    }

    if (!allowedRoles.includes(role)) {
      res.status(403).json({
        error: "insufficient_permissions",
        detail: `This action requires one of: ${allowedRoles.join(", ")}`
      });
      return;
    }

    next();
  };
}

/**
 * requireAdminRole — restrict a route to admin-role users only.
 *
 * API key auth (no role attached) bypasses this check — API keys are
 * treated as admin-level. JWT users with any role other than "admin"
 * receive a 403.
 */
export function requireAdminRole(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const role = req.userRole ?? (req as any).jwtPayload?.role;

  if (!role) { next(); return; }

  if (role === "admin") { next(); return; }

  res.status(403).json({
    error: "forbidden",
    message: "This action requires admin role."
  });
}

/**
 * requireNotViewer — block viewer-role users from mutation endpoints.
 *
 * Viewer enforcement is also baked into requireApiKey for the JWT path,
 * so this is available for explicit decoration on specific routes.
 */
export function requireNotViewer(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const role = req.userRole ?? (req as any).jwtPayload?.role;

  if (role === "viewer") {
    res.status(403).json({
      error: "read_only_access",
      detail: "Viewer accounts cannot make changes."
    });
    return;
  }

  next();
}
