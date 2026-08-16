/**
 * tdgFeatureFlag.ts — the dark control for Tenant Data Governance.
 *
 * Off means the capability does not exist as far as any caller can tell: every
 * governed route 404s, including the owner's own delete. Shipping the code dark
 * and proving it inert is the whole point of landing a destructive capability
 * before it is authorized.
 *
 * Lives in middleware/ rather than in the governance router so the Ask routes
 * can gate the owner-deletion path on the same flag without importing a router.
 */

import type { Request, Response, NextFunction } from "express";
import { tenantDataGovernanceEnabled } from "../lib/governance/tdgPolicy.js";

export function tdgFeatureFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!tenantDataGovernanceEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
