import { cleanText } from "../utils/contentSanitizer.js";
import { normalizeCategory } from "../utils/categoryMapper.js";

type TrendInput = {
  title: string;
  summary: string;
  category: string;
  score: number;
  riskLevel: "critical" | "high" | "medium" | "low";
  whyItMatters: string;
  recommendedAction: string;
};

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0.5;
}

function normalizeRiskLevel(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 0.9) return "critical";
  if (score >= 0.75) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function buildWhyItMatters(title: string, summary: string, category: string, score: number): string {
  const text = `${title} ${summary}`.toLowerCase();
  const riskLevel = normalizeRiskLevel(score);

  if (text.includes("zero-day") || text.includes("actively exploited")) {
    return "This indicates active exploitation pressure and raises the likelihood of near-term enterprise exposure if vulnerable assets remain unpatched.";
  }

  if (text.includes("phishing") || text.includes("credential")) {
    return "This increases the likelihood of credential theft, account compromise, and downstream enterprise access abuse if identity and email controls are weak.";
  }

  if (text.includes("malware") || text.includes("ransomware") || text.includes("trojan")) {
    return "This reflects active tradecraft that could drive endpoint compromise, lateral movement, or operational disruption depending on control maturity.";
  }

  if (category === "REGULATION") {
    return "This may raise governance, documentation, and accountability expectations, especially for organizations with regulated or externally scrutinized operations.";
  }

  if (category === "AI_GOVERNANCE") {
    return "This may affect acceptable use boundaries, governance expectations, and leadership oversight for enterprise AI adoption.";
  }

  if (category === "VENDOR_RISK") {
    return "This may increase third-party exposure and requires validation of vendor controls, dependencies, and business impact pathways.";
  }

  if (riskLevel === "high" || riskLevel === "critical") {
    return "This represents a high-priority security development with potential business impact if exposure is confirmed and response actions lag.";
  }

  return "This is relevant to enterprise risk monitoring and should be evaluated for applicability, exposure, and control sufficiency.";
}

function buildRecommendedAction(title: string, summary: string, category: string, score: number): string {
  const text = `${title} ${summary}`.toLowerCase();
  const riskLevel = normalizeRiskLevel(score);

  if (text.includes("zero-day") || text.includes("patch")) {
    return "Identify affected assets immediately, validate exposure, prioritize patching or mitigations, and monitor for exploitation attempts.";
  }

  if (text.includes("phishing") || text.includes("credential")) {
    return "Review email security controls, strengthen MFA enforcement, monitor for suspicious authentication activity, and brief response teams on likely attack patterns.";
  }

  if (text.includes("malware") || text.includes("ransomware") || text.includes("trojan")) {
    return "Validate endpoint coverage, review detection logic, and confirm incident response readiness for malware-driven compromise scenarios.";
  }

  if (category === "REGULATION") {
    return "Assess whether policies, governance documentation, reporting obligations, or control evidence need to be updated in response to this development.";
  }

  if (category === "AI_GOVERNANCE") {
    return "Review AI governance policies, approval workflows, and model oversight expectations before broader deployment or expanded enterprise use.";
  }

  if (category === "VENDOR_RISK") {
    return "Evaluate affected vendor dependencies, validate third-party controls, and determine whether contractual, technical, or monitoring actions are needed.";
  }

  if (riskLevel === "high" || riskLevel === "critical") {
    return "Validate applicability immediately, assign an owner, and determine whether containment, mitigation, or executive escalation is required.";
  }

  return "Review the development for applicability and confirm that relevant technical, governance, or operational controls remain appropriate.";
}

export function generateTrends(signals: any[]) {
  const trends: TrendInput[] = [];

  for (const signal of signals) {
    const title = cleanText(signal.title || "");
    const summary = cleanText(signal.summary || signal.rawContent || "").slice(0, 500);
    const category = normalizeCategory(signal.category || "");
    const score = toNumber(signal.score || signal.priority || signal.impactScore || 0.5);
    const riskLevel = normalizeRiskLevel(score);

    if (!title) continue;

    trends.push({
      title,
      summary,
      category,
      score,
      riskLevel,
      whyItMatters: buildWhyItMatters(title, summary, category, score),
      recommendedAction: buildRecommendedAction(title, summary, category, score)
    });
  }

  trends.sort((a, b) => b.score - a.score);

  return trends.slice(0, 10);
}
