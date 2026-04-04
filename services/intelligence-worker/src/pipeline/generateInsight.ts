import { analyzeSignal } from "./aiAnalysis.js";

function buildAudience(signal: any) {
  const category = signal.category || "GENERAL";

  if (category === "SECURITY_INCIDENT") {
    return ["Security Operations", "IT", "Security Leadership"];
  }

  if (category === "REGULATION") {
    return ["Compliance", "Legal", "Executive Leadership"];
  }

  if (category === "AI_GOVERNANCE") {
    return ["AI Governance", "Risk", "Executive Leadership"];
  }

  if (category === "VENDOR_RISK") {
    return ["TPRM", "Procurement", "Security Leadership"];
  }

  return ["Security Leadership", "Risk"];
}

function normalizeRisk(level: string | undefined) {
  const l = String(level || "").toLowerCase();

  if (l.includes("critical")) return "critical";
  if (l.includes("high")) return "high";
  if (l.includes("medium")) return "medium";

  return "low";
}

function buildExecutiveImpact(signal: any, riskLevel: string) {
  const text = `${signal.title || ""} ${signal.summary || ""} ${signal.rawContent || ""}`.toLowerCase();

  if (riskLevel === "critical") {
    return "Immediate enterprise exposure likely. Requires urgent validation and response.";
  }

  if (text.includes("zero-day") || text.includes("actively exploited")) {
    return "Active exploitation increases the likelihood of near-term enterprise exposure if affected assets remain unaddressed.";
  }

  if (text.includes("credential") || text.includes("phishing")) {
    return "Increases the likelihood of credential compromise, unauthorized access, and downstream identity abuse.";
  }

  if (
    text.includes("malware") ||
    text.includes("ransomware") ||
    text.includes("trojan") ||
    text.includes("backdoor")
  ) {
    return "Signals malicious tradecraft that could drive endpoint compromise, disruption, or broader business impact.";
  }

  if (signal.category === "AI_GOVERNANCE") {
    return "Introduces governance, oversight, and policy alignment risk as enterprise AI adoption expands.";
  }

  if (signal.category === "REGULATION") {
    return "May increase compliance obligations, governance expectations, and audit or enforcement exposure.";
  }

  if (riskLevel === "high") {
    return "High likelihood of exploitation or business impact if unaddressed.";
  }

  return "Potential operational or security impact depending on exposure.";
}

function buildThreatSpecificRecommendation(signal: any, riskLevel: string) {
  const text = `${signal.title || ""} ${signal.summary || ""} ${signal.rawContent || ""}`.toLowerCase();

  if (text.includes("zero-day") || text.includes("patch")) {
    return "Identify affected systems immediately, prioritize remediation, and monitor for active exploitation attempts.";
  }

  if (text.includes("credential") || text.includes("phishing")) {
    return "Strengthen identity protections, enforce MFA, and monitor authentication anomalies and email-driven attack patterns.";
  }

  if (
    text.includes("malware") ||
    text.includes("ransomware") ||
    text.includes("trojan") ||
    text.includes("backdoor")
  ) {
    return "Validate endpoint coverage, review detections, and confirm incident response readiness for compromise scenarios tied to this activity.";
  }

  if (signal.category === "AI_GOVERNANCE") {
    return "Review AI governance policies, approval workflows, model oversight, and acceptable use controls before broader deployment.";
  }

  if (signal.category === "REGULATION") {
    return "Assess whether policies, governance documentation, reporting obligations, or control evidence should be updated.";
  }

  if (riskLevel === "critical" || riskLevel === "high") {
    return "Validate exposure immediately, assign ownership, and determine whether escalation or immediate mitigation is required.";
  }

  return "Review applicability and ensure appropriate controls are in place.";
}

function enforceRecommendation(rec: string, signal: any, riskLevel: string) {
  if (!rec || rec.trim().length < 20) {
    return buildThreatSpecificRecommendation(signal, riskLevel);
  }

  const generic =
    rec.includes("Review endpoint detection coverage") ||
    rec.includes("Review applicability and ensure appropriate controls are in place.") ||
    rec.includes("Validate exposure immediately");

  if (generic) {
    return buildThreatSpecificRecommendation(signal, riskLevel);
  }

  return rec;
}

export async function generateInsight(signal: any) {
  const ai = await analyzeSignal(signal);

  const signalId = signal.signalId || signal.id || `SIG-${Date.now()}`;
  const riskLevel = normalizeRisk(ai.riskLevel);
  const analysis = ai.analysis || signal.summary || "";
  const executiveImpact = buildExecutiveImpact(signal, riskLevel);
  const recommendation = enforceRecommendation(ai.recommendation || "", signal, riskLevel);

  return {
    id: `INS-${signalId}`,
    signalId,
    category: signal.category || "GENERAL",
    title: signal.title,
    analysis,
    recommendation,
    recommendedAction: recommendation,
    riskLevel,
    executiveImpact,
    riskImplication: executiveImpact,
    whyItMatters: executiveImpact,
    audience: buildAudience(signal),
    createdAt: new Date().toISOString()
  };
}
