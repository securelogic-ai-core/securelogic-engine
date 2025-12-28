import type { LicenseV1 } from "./LicenseV1";

export function assertLicense(l: LicenseV1): void {
  if (new Date(l.expiresAt).getTime() <= Date.now()) {
    throw new Error("LICENSE_EXPIRED");
  }
}
