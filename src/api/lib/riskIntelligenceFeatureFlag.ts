/**
 * riskIntelligenceFeatureFlag.ts — ERIP Epic 3: the Risk Intelligence feature
 * flag. Gates the graph-aware risk surfaces (risk propagation, rollups). When
 * off, every risk-intelligence route returns 404 BEFORE any handler/auth, so a
 * probing caller cannot learn the surface exists, and no existing behavior
 * changes.
 *
 * DEFAULT OFF everywhere. Strict `=== "true"` predicate (the ECL / asset-registry
 * shape) — no NODE_ENV escape hatch. Prod enablement is out of scope for the
 * ERIP program (GATE B posture).
 */

import type { Request, Response, NextFunction } from "express";

export function riskIntelligenceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_RISK_INTELLIGENCE_ENABLED"] === "true";
}

/** Express middleware. Short-circuits to a bare 404 when the flag is off. */
export function riskIntelligenceFeatureFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!riskIntelligenceEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
