/**
 * riskAcceptanceFeatureFlag.ts — SECURELOGIC_RISK_ACCEPTANCE_ENABLED.
 *
 * Gates ENFORCEMENT of the risk-acceptance lifecycle (ruling 2026-07-12), not the
 * existence of the data. The table, the routes and the audit trail are additive and
 * harmless; what the flag controls is whether an approved acceptance actually CLOSES a
 * Finding, and therefore whether a customer's Active Findings population moves.
 *
 * Flag OFF (production, initially) — byte-identical to the behaviour before this
 * package. `decision_state='accepted_risk'` does not close anything;
 * `hasBindingAcceptance` is never true. Existing prod workflows do not break on the day
 * this ships.
 *
 * Flag ON (staging) — the full lifecycle: acceptance requires approval by someone other
 * than the requester, approval closes the Finding, expiry or withdrawal reopens it.
 *
 * The legacy accepted population is NOT affected by this flag in either position: those
 * findings are closed by the legacy compat bridge (`status='accepted'` is terminal), so
 * they stay closed whether the flag is on or off. Their `finding_risk_acceptances` rows
 * are governance-review markers, not closure inputs.
 */

import type { Request, Response, NextFunction } from "express";

export function riskAcceptanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"] === "true";
}

/**
 * Express middleware. Short-circuits to a bare 404 when the flag is off, matching the
 * risk-lifecycle / vendor-assurance closed-route posture. Apply as the FIRST middleware
 * on every acceptance route, before requireApiKey — a disabled feature must not even
 * admit that it exists.
 */
export function riskAcceptanceFeatureFlag(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!riskAcceptanceEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
