import type { Request } from "express";
import type { LicenseTier } from "../../contracts/LicenseTier";
import { verifyLicenseToken } from "./licenseToken";

/**
 * Resolves the caller's license tier from Authorization header.
 * Defaults to FREE if missing or invalid.
 */
export function resolveLicense(req: Request): LicenseTier {
  const auth = req.header("authorization");

  if (!auth || !auth.startsWith("Bearer ")) {
    return "FREE";
  }

  const token = auth.slice(7);

  try {
    const claims = verifyLicenseToken(token);
    return claims.tier;
  } catch {
    return "FREE";
  }
}