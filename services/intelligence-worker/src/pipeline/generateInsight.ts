import { analyzeSignal } from "./aiAnalysis.js";

function buildAudience(signal: any) {
  const category = signal.category || "GENERAL";
  const title = String(signal.title || "").toLowerCase();
  const text = `${title} ${signal.rawContent || signal.payload || ""}`.toLowerCase();

  if (category === "SECURITY_INCIDENT") {
    if (
      text.includes("credential") ||
      text.includes("phishing") ||
      text.includes("trojan") ||
      text.includes("malware") ||
      text.includes("ransomware") ||
      text.includes("exploit")
    ) {
      return [
        "Security Operations",
        "IT Administrators",
        "Security Leaders",
        "Risk Teams"
      ];
    }

    if (
      text.includes("hackers") ||
      text.includes("espionage") ||
      text.includes("state-sponsored")
    ) {
      return [
        "Threat Intelligence Teams",
        "Security Leaders",
        "Risk Teams",
        "Executive Leadership"
      ];
    }

    return [
      "Security Leaders",
      "Risk Teams",
      "IT Administrators"
    ];
  }

  if (category === "REGULATION") {
    return [
      "Compliance Teams",
      "Legal Teams",
      "Risk Teams",
      "Executive Leadership"
    ];
  }

  if (category === "AI_GOVERNANCE") {
    return [
      "AI Governance Leaders",
      "Compliance Teams",
      "Risk Teams",
      "Executive Leadership"
    ];
  }

  if (category === "VENDOR_RISK") {
    return [
      "Third-Party Risk Teams",
      "Procurement",
      "Security Leaders",
      "Risk Teams"
    ];
  }

  if (category === "COMPLIANCE_UPDATE") {
    return [
      "Compliance Teams",
      "Internal Audit",
      "Risk Teams",
      "Executive Leadership"
    ];
  }

  return [
    "Security Leaders",
    "Risk Teams"
  ];
}

export async function generateInsight(signal: any) {
  const ai = await analyzeSignal(signal);

  const signalId = signal.signalId || signal.id || `SIG-${Date.now()}`;

  return {
    id: `INS-${signalId}`,
    signalId,
    category: signal.category || "GENERAL",
    title: signal.title,
    analysis: ai.analysis,
    recommendation: ai.recommendation,
    riskLevel: ai.riskLevel,
    audience: buildAudience(signal),
    createdAt: new Date().toISOString()
  };
}