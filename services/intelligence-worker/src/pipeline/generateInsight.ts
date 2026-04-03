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
  const title = String(signal.title || "").toLowerCase();

  if (riskLevel === "critical") {
    return "Immediate enterprise exposure likely. Requires urgent validation and response.";
  }

  if (riskLevel === "high") {
    return "High likelihood of exploitation or business impact if unaddressed.";
  }

  if (title.includes("zero-day")) {
    return "Active exploitation with limited defensive coverage.";
  }

  if (title.includes("phishing") || title.includes("credential")) {
    return "Increased likelihood of credential compromise across enterprise users.";
  }

  return "Potential operational or security impact depending on exposure.";
}

function enforceRecommendation(rec: string, riskLevel: string) {
  if (!rec || rec.length < 20) {
    if (riskLevel === "critical" || riskLevel === "high") {
      return "Validate exposure immediately, enforce controls, and initiate monitoring or response actions.";
    }

    return "Review applicability and ensure appropriate controls are in place.";
  }

  return rec;
}

export async function generateInsight(signal: any) {
  const ai = await analyzeSignal(signal);

  const signalId = signal.signalId || signal.id || `SIG-${Date.now()}`;

  const riskLevel = normalizeRisk(ai.riskLevel);

  const analysis = ai.analysis || signal.summary || "";

  const recommendation = enforceRecommendation(
    ai.recommendation,
    riskLevel
  );

  const executiveImpact = buildExecutiveImpact(signal, riskLevel);

  return {
    id: `INS-${signalId}`,
    signalId,
    category: signal.category || "GENERAL",
    title: signal.title,

    // CORE INTELLIGENCE
    analysis,
    recommendation,
    riskLevel,

    // WHAT YOU WERE MISSING
    executiveImpact,

    // TARGETING
    audience: buildAudience(signal),

    createdAt: new Date().toISOString()
  };
}
