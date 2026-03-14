export async function analyzeSignal(signal: any) {
  const title = String(signal.title || "");
  const text = `${title} ${signal.rawContent || signal.payload || ""}`.toLowerCase();

  let riskLevel: "low" | "medium" | "high" = "low";
  let analysis = `The development reported in "${title}" may affect enterprise governance, security, or compliance posture.`;
  let recommendation =
    "Security and risk teams should review the development and determine whether internal controls, threat monitoring, or governance processes need to be updated.";

  if (
    text.includes("malware") ||
    text.includes("trojan") ||
    text.includes("ransomware") ||
    text.includes("credential theft") ||
    text.includes("seo poisoning") ||
    text.includes("phishing") ||
    text.includes("exploit")
  ) {
    riskLevel = "high";
    analysis = `The event reported in "${title}" reflects active malicious tradecraft that could affect enterprise users, identities, or systems if similar techniques are reused more broadly. This is especially relevant where credential security, endpoint protection, and user-driven software downloads are weak points.`;
    recommendation =
      "Review endpoint detection coverage, validate email and web filtering controls, and assess whether credential monitoring, MFA enforcement, and threat-hunting content should be updated.";
  } else if (
    text.includes("hackers") ||
    text.includes("cybercrime") ||
    text.includes("arrests") ||
    text.includes("malicious ip") ||
    text.includes("state-sponsored") ||
    text.includes("espionage")
  ) {
    riskLevel = "medium";
    analysis = `The development reported in "${title}" signals ongoing adversary activity and may indicate broader threat patterns relevant to enterprise environments, especially for organizations in sensitive sectors or connected supply chains.`;
    recommendation =
      "Review sector-specific exposure, monitor threat intelligence feeds for related indicators, and confirm that logging, alerting, and third-party monitoring processes remain effective.";
  } else if (
    text.includes("eu ai act") ||
    text.includes("guidance") ||
    text.includes("regulator") ||
    text.includes("regulation") ||
    text.includes("enforcement")
  ) {
    riskLevel = "medium";
    analysis = `The development reported in "${title}" may increase regulatory expectations around AI governance, documentation, and accountability. Organizations using AI in business processes should evaluate whether current governance controls and policy frameworks align with emerging requirements.`;
    recommendation =
      "Review AI governance policies, model inventory documentation, risk assessments, and accountability structures to determine whether regulatory or policy updates are required.";
  } else if (
    text.includes("open-source ai") ||
    text.includes("open source ai") ||
    text.includes("ai model") ||
    text.includes("llm") ||
    text.includes("governance")
  ) {
    riskLevel = "medium";
    analysis = `The development reported in "${title}" highlights governance questions around model usage, transparency, and control. Enterprises adopting new AI capabilities should evaluate oversight, acceptable use boundaries, and downstream business risk.`;
    recommendation =
      "Confirm that AI usage policies, approval workflows, model evaluation criteria, and monitoring expectations are defined before broader deployment.";
  } else if (
    text.includes("encrypted chat") ||
    text.includes("end-to-end encrypted") ||
    text.includes("e2ee")
  ) {
    riskLevel = "medium";
    analysis = `The development reported in "${title}" may change privacy, monitoring, and data-protection assumptions for organizations relying on consumer messaging ecosystems. It is more of a security architecture and communications risk issue than a direct threat event.`;
    recommendation =
      "Review whether any business communications, customer interactions, or policy assumptions rely on the affected platform’s encryption posture and update guidance accordingly.";
  }

  return {
    analysis,
    recommendation,
    riskLevel
  };
}