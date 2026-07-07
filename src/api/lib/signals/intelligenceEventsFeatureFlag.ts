/**
 * intelligenceEventsFeatureFlag.ts — kill switch for the canonical Intelligence
 * Event projection. Intelligence Pipeline Hardening / IE (memo
 * IE-INTELLIGENCE-EVENTS-MEMO.md).
 *
 * When ON, cyber_signals are projected into the canonical intelligence_events
 * layer (corroboration ledger + timeline) and downstream surfaces may read it.
 * When OFF — the default in EVERY environment, including dev/test — the
 * projection does zero DB work and every existing surface (brief, matcher,
 * dashboards) behaves byte-identically to pre-epic. IE-AD-8.
 *
 * OFF by default. Enabled ONLY when SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED
 * === "true". Production enablement is operator-owned (GATE B); staging first.
 */
import type { Request, Response, NextFunction } from "express";

export function intelligenceEventsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED"] === "true";
}

/** Express middleware — bare 404 when the flag is off (surface hidden while dark). */
export function intelligenceEventsFeatureFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!intelligenceEventsEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
