/**
 * predictiveIntelligenceFeatureFlag.ts — ERIP Epic 5: the Predictive
 * Intelligence feature flag. Gates the forecast surfaces. When off, every
 * predictive route 404s BEFORE any handler/auth, and no existing behavior
 * changes.
 *
 * DEFAULT OFF everywhere. Strict `=== "true"` predicate. Prod enablement is out
 * of scope for the ERIP program (GATE B posture).
 */

import type { Request, Response, NextFunction } from "express";

export function predictiveIntelligenceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED"] === "true";
}

export function predictiveIntelligenceFeatureFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!predictiveIntelligenceEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
