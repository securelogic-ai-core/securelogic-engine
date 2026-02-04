/**
 * Issue Contract (Authoritative)
 * This defines the ONLY valid Issue shape in SecureLogic production.
 */

export type RiskRating = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskDomain =
  | "Operational Resilience"
  | "Third-Party Risk"
  | "Identity"
  | "Governance"
  | "Compliance"
  | "Security";

export interface RiskEntry {
  domain: RiskDomain;
  rating: RiskRating;
}

export interface Issue {
  issueNumber: number;
  title: string;
  executiveSummary: string;
  domains: RiskDomain[];
  riskTable: RiskEntry[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  publishedAt: string; // ISO-8601
}

/**
 * Runtime contract guard
 * FAIL CLOSED
 */
export function isIssue(value: unknown): value is Issue {
  if (!value || typeof value !== "object") return false;

  const v = value as Record<string, unknown>;

  return (
    typeof v.issueNumber === "number" &&
    typeof v.title === "string" &&
    typeof v.executiveSummary === "string" &&
    Array.isArray(v.domains) &&
    v.domains.every(d => typeof d === "string") &&
    Array.isArray(v.riskTable) &&
    v.riskTable.every(
      r =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as any).domain === "string" &&
        typeof (r as any).rating === "string"
    ) &&
    (v.confidence === "LOW" ||
      v.confidence === "MEDIUM" ||
      v.confidence === "HIGH") &&
    typeof v.publishedAt === "string"
  );
}
