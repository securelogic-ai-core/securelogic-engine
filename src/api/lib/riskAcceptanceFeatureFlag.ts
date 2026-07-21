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
 * The EXISTING legacy accepted population (findings already at `status='accepted'`) is NOT
 * affected in either position: those findings stay closed, and their
 * `finding_risk_acceptances` rows are governance-review markers, not closure inputs.
 *
 * NEW writes are gated (P0, 2026-07-15). When the flag is ON, no direct write may fabricate
 * an accepted state without the signed workflow: `decision_state='accepted_risk'` (Decision
 * Workspace + bulk decide) and the legacy `status='accepted'` shorthand are both refused
 * with `use_risk_acceptance_workflow` — see `findingAcceptanceWorkflow.ts`. When OFF
 * (production), every path is byte-identical to before; the legacy accept still closes.
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
