/**
 * signalApplicabilityFeatureFlag.ts — Enterprise Risk Graph convergence (C3).
 *
 * Gates the Signal → ApplicabilityEngineV1 convergence path. DEFAULT OFF
 * everywhere (strict `=== "true"`, no NODE_ENV escape hatch) so the legacy
 * signal→vendor path stays byte-for-byte authoritative until an operator enables
 * it per-service. Engine-only flag (not read by the app).
 *
 * Two-position sub-mode so the convergence can be measured before it is trusted:
 *   - "shadow"  (default when the flag is on): run the new path ALONGSIDE the
 *     legacy path, compare, emit telemetry — surface NOTHING, write NOTHING to
 *     customer tables. The legacy path remains authoritative.
 *   - "surface": reserved for AFTER the shadow period proves convergence and an
 *     explicit cutover is approved. Not consumed yet.
 */

export function signalApplicabilityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED"] === "true";
}

export type SignalApplicabilityMode = "shadow" | "surface";

export function signalApplicabilityMode(env: NodeJS.ProcessEnv = process.env): SignalApplicabilityMode {
  return env["SECURELOGIC_SIGNAL_APPLICABILITY_MODE"] === "surface" ? "surface" : "shadow";
}

/**
 * Express middleware — short-circuits to a bare 404 when the flag is off, so the
 * attestation surface (C4 part 2) does not exist while the convergence is dark. Same
 * shape as riskIntelligenceFeatureFlag; flag-off behaviour is byte-identical to before
 * the route existed.
 */
export function signalApplicabilityFeatureFlag(
  _req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): void {
  if (!signalApplicabilityEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
