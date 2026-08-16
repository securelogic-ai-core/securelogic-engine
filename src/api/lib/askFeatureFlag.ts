/**
 * askFeatureFlag.ts — the kill switch for Ask SecureLogic.
 *
 * Ask shipped with NO flag of any kind. Every other capability of comparable
 * blast radius in this codebase (vendor assurance, risk lifecycle, decision
 * workspace, intelligence events, seat model) carries one, because an operator
 * needs a way to close a surface that is misbehaving — leaking, hallucinating,
 * or burning provider credit — without cutting a release.
 *
 * Ask is exactly the surface that most needs it: it is an LLM-mediated read
 * path over customer risk data, and its cost is unbounded per request.
 *
 * Activation rules mirror vendorAssuranceFeatureFlag.ts, with ONE deliberate
 * difference: Ask defaults to ENABLED when the variable is absent, including in
 * production. Ask is already live in production today, so defaulting to off
 * would silently remove a shipped capability the moment this lands. The flag is
 * a kill switch, not a dark launch — turning it off is an explicit operator act.
 *
 *   SECURELOGIC_ASK_ENABLED = "false"  → disabled (404)
 *   anything else / absent             → enabled
 *
 * The 404 (rather than 403) matches the closed-route posture used elsewhere: a
 * prober cannot learn that the surface exists.
 */

import type { Request, Response, NextFunction } from "express";

export function askEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_ENABLED"] !== "false";
}

/**
 * Express middleware. Short-circuits to 404 with no body details when the flag
 * is off, BEFORE any handler logic, any DB read, and any provider call.
 */
export function askFeatureFlag(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!askEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
