import type { Request, Response } from "express";

/**
 * Fail closed on a caller who is permitted but not human.
 *
 * `requireCapability("assurance:review")` on the route answers "is this
 * identity permitted to review assurance". It CANNOT answer "is this a human":
 * `scopeForApiKey()` resolves an API key to a full/admin seat, so a machine
 * caller holds every capability a tenant-write identity holds, including this
 * one. Human authority is a separate axis, and this is where it is checked at
 * the request layer — before any read, so an unattributed caller cannot even
 * learn the shape of the record it is not entitled to decide.
 *
 * The database refuses the same thing independently (20261076, 20261077). Two
 * layers, because the route is not the boundary.
 */
export function requireHumanReviewer(req: Request, res: Response, action: string): string | null {
  const userId = req.userId ?? null;
  if (!userId) {
    res.status(403).json({
      error: "human_reviewer_required",
      detail:
        `${action} is a governance determination and must name the person who made it. ` +
        "This request carries no authenticated user; an API key alone establishes " +
        "permission, never human authority."
    });
    return null;
  }
  return userId;
}
