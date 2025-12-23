import jwt, { SignOptions } from "jsonwebtoken";
import { LicenseTier } from "../../contracts/LicenseTier";

const LICENSE_SECRET: jwt.Secret =
  process.env.LICENSE_SECRET || "dev-secret-change-me";

export interface LicenseClaims {
  tier: LicenseTier;
}

export function issueLicenseToken(
  tier: LicenseTier,
  expiresIn: SignOptions["expiresIn"] = "30d"
): string {
  return jwt.sign(
    { tier },
    LICENSE_SECRET,
    { expiresIn }
  );
}

export function verifyLicenseToken(token: string): LicenseClaims {
  return jwt.verify(token, LICENSE_SECRET) as LicenseClaims;
}