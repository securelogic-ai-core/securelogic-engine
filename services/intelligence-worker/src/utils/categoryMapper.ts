export function normalizeCategory(input: string) {
  const text = (input || "").toLowerCase();

  if (text.includes("security") || text.includes("cyber")) return "SECURITY_INCIDENT";
  if (text.includes("ai")) return "AI_GOVERNANCE";
  if (text.includes("reg")) return "REGULATION";
  if (text.includes("vendor")) return "VENDOR_RISK";
  if (text.includes("compliance")) return "COMPLIANCE_UPDATE";

  return "GENERAL";
}
