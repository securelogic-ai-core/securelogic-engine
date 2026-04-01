export const CATEGORIES = [
  "SECURITY_INCIDENT",
  "AI_GOVERNANCE",
  "REGULATION",
  "VENDOR_RISK",
  "COMPLIANCE_UPDATE",
  "GENERAL"
] as const;

export type Category = typeof CATEGORIES[number];

export function isValidCategory(cat: string): cat is Category {
  return CATEGORIES.includes(cat as Category);
}
