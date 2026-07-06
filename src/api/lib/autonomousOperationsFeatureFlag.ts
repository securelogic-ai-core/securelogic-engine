/**
 * autonomousOperationsFeatureFlag.ts — ERIP Epic 6: the Autonomous Operations
 * feature flag. Gates the orchestration surfaces. When off, every orchestration
 * route 404s BEFORE any handler/auth, and no existing behavior changes.
 *
 * DEFAULT OFF everywhere. Strict `=== "true"` predicate. Prod enablement is out
 * of scope for the ERIP program (GATE B posture).
 */

import type { Request, Response, NextFunction } from "express";

export function autonomousOperationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED"] === "true";
}

export function autonomousOperationsFeatureFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!autonomousOperationsEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
