/**
 * vulnScanIngestionFlag.ts — kill switch for the scanner-ingestion intake
 * (SL-OCC-3).
 *
 * Default-DENY (=== "true"), everywhere including non-production, for the same
 * reason the vendor portal is: this surface AUTO-CREATES findings and
 * occurrences at import scale. A capability that can add two thousand rows to
 * a customer's register in one request must never be open by accident on a
 * preview environment.
 *
 * Off = 404 before any handler work — the surface is indistinguishable from
 * absent, matching the portal's dark posture.
 *
 * DELIBERATELY NOT DECLARED IN render.yaml ON THIS BRANCH: the R-1 flag
 * reconciliation (§G) is release evidence over the frozen candidate, and a
 * render.yaml production-block edit invalidates it. Declare the key (value
 * "false") in IaC at merge time, after the boundary reopens — the resolver
 * below makes undeclared and "false" identical, so nothing is dark-by-accident
 * in the meantime; it is dark by construction.
 */
import type { NextFunction, Request, Response } from "express";

export function vulnScanIngestionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_VULN_SCAN_INGESTION_ENABLED"] === "true";
}

export function vulnScanIngestionFeatureFlag(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!vulnScanIngestionEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
