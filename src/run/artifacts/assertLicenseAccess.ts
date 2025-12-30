export function assertLicenseAccess(
  tier: string | undefined,
  artifactType: "PDF" | "DASHBOARD"
) {
  if (!tier) throw new Error("MISSING_LICENSE");

  if (artifactType === "PDF" && tier === "CORE") {
    throw new Error("LICENSE_RESTRICTED");
  }
}
