import { Category } from "../constants/categories.js";

type ClassificationResult = {
  primary: Category;
  all: Category[];
  reason: string;
};

export function classifyCategory(title: string, rawContent: string): ClassificationResult {
  const text = `${title} ${rawContent}`.toLowerCase();

  const matches: Category[] = [];
  const reasons: string[] = [];

  if (/(cve|zero-day|exploit|breach|ransomware|malware|phishing|attack|trojan|cybercrime)/.test(text)) {
    matches.push("SECURITY_INCIDENT");
    reasons.push("matched:security-keywords");
  }

  if (/(regulation|guidance|regulator|commission|eu ai act|enforcement|law)/.test(text)) {
    matches.push("REGULATION");
    reasons.push("matched:regulation-keywords");
  }

  if (/(soc 2|nist|iso|compliance|audit|attestation)/.test(text)) {
    matches.push("COMPLIANCE_UPDATE");
    reasons.push("matched:compliance-keywords");
  }

  if (/(vendor|third[-\s]?party|supplier|saas|service provider)/.test(text)) {
    matches.push("VENDOR_RISK");
    reasons.push("matched:vendor-risk-keywords");
  }

  if (/(artificial intelligence|\bai\b|llm|foundation model|open[-\s]?source ai|ai model|model governance|ai governance)/.test(text)) {
    matches.push("AI_GOVERNANCE");
    reasons.push("matched:ai-governance-keywords");
  }

  if (matches.length === 0) {
    return {
      primary: "GENERAL",
      all: ["GENERAL"],
      reason: "fallback:no-match"
    };
  }

  return {
    primary: matches[0],
    all: matches,
    reason: reasons.join(", ")
  };
}
