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

  // VULNERABILITY checked first: tight vocabulary that genuinely identifies a
  // CVE/patch/advisory article. Beats SECURITY_INCIDENT's broad regex when both
  // match (e.g. "Microsoft patches CVE-2024-X" matches "cve" in both buckets).
  if (/(cve-\d{4}|cwe-\d|\bvulnerability\b|\bvulnerabilities\b|\bzero-day\b|\bremote code execution\b|\brce\b|\bprivilege escalation\b|\bcvss\b|\bpatch\b|\bsecurity advisory\b)/.test(text)) {
    matches.push("VULNERABILITY");
    reasons.push("matched:vulnerability-keywords");
  }

  if (/(regulation|guidance|regulator|commission|enforcement|law |penalty|fine |settlement|violation|nydfs|ftc |sec |cisa|enisa|ico |fsb |gdpr|ccpa|hipaa|nist|sox |pci |cybersecurity disclosure|material incident|breach notification|data protection|privacy act|circular letter|advisory|alert)/.test(text)) {
    matches.push("REGULATION");
    reasons.push("matched:regulation-keywords");
  }

  if (/(artificial intelligence|\bai\b|llm|foundation model|open[-\s]?source ai|ai model|model governance|ai governance)/.test(text)) {
    matches.push("AI_GOVERNANCE");
    reasons.push("matched:ai-governance-keywords");
  }

  if (/(cve|zero-day|exploit|breach|ransomware|malware|phishing|attack|trojan|cybercrime)/.test(text)) {
    matches.push("SECURITY_INCIDENT");
    reasons.push("matched:security-keywords");
  }

  if (/(soc 2|iso 27001|nist csf|compliance|audit|attestation|framework|control|assessment|certification|maturity)/.test(text)) {
    matches.push("COMPLIANCE_UPDATE");
    reasons.push("matched:compliance-keywords");
  }

  if (/(vendor|third[-\s]?party|supplier|saas|service provider)/.test(text)) {
    matches.push("VENDOR_RISK");
    reasons.push("matched:vendor-risk-keywords");
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
