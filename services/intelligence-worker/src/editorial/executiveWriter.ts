function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function removeQuotedTitle(text: string, title: string): string {
  const t = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^"?${t}"?\\s*(reflects|signals|raises)?\\s*`, "i");
  return text.replace(regex, "").trim();
}

function stripAiTone(text: string): string {
  return clean(
    text
      .replace(/^the event reported in\s+/i, "")
      .replace(/^the development reported in\s+/i, "")
      .replace(/\bhighlights\b/gi, "signals")
      .replace(/\bmay increase\b/gi, "raises")
      .replace(/\bshould assess\b/gi, "should evaluate")
      .replace(/\bthis is most relevant where\b/gi, "Most relevant where")
  );
}

/**
 * CORE FIX: Specific, executive-grade, non-generic analysis
 */
function compressAnalysis(title: string, analysis: string, category: string): string {
  let text = stripAiTone(clean(analysis));
  text = removeQuotedTitle(text, title);

  const t = title.toLowerCase();

  // SECURITY INCIDENT SPECIFICITY
  if (category === "SECURITY_INCIDENT") {
    if (t.includes("ios") || t.includes("android") || t.includes("app")) {
      return "Malicious mobile applications targeting user devices, increasing risk of data exfiltration and credential or asset compromise.";
    }

    if (t.includes("wallet") || t.includes("crypto") || t.includes("recovery")) {
      return "Targeted theft of high-value digital assets through compromise of user-controlled recovery data.";
    }

    if (t.includes("phishing") || t.includes("credential")) {
      return "Credential-focused attack activity targeting enterprise users and authentication flows.";
    }

    if (t.includes("ransomware") || t.includes("malware")) {
      return "Active malware activity with potential for endpoint compromise and operational disruption.";
    }

    return "Active threat activity with potential impact to enterprise systems and user accounts.";
  }

  // AI GOVERNANCE
  if (category === "AI_GOVERNANCE") {
    return "Emerging AI capability introducing governance, oversight, and usage control considerations.";
  }

  // REGULATION
  if (category === "REGULATION") {
    return "Regulatory development introducing new expectations for governance, documentation, and accountability.";
  }

  // fallback (trimmed but still useful)
  if (text.length > 180) {
    text = text.split(". ")[0] + ".";
  }

  return sentenceCase(text || "Relevant development requiring evaluation for enterprise impact.");
}

function rewriteItem(item: any): any {
  const title = clean(item.title);
  const category = clean(item.category || "GENERAL");
  const riskLevel = clean(item.riskLevel || item.risk_level || "low").toLowerCase();

  const analysis = compressAnalysis(
    title,
    clean(item.analysis || item.summary || ""),
    category
  );

  const why = clean(
    item.whyItMatters ||
    item.executiveImpact ||
    item.riskImplication ||
    ""
  );

  const action = clean(
    item.recommendedAction ||
    item.recommendation ||
    ""
  );

  return {
    ...item,
    title,
    category,
    riskLevel,
    risk_level: riskLevel,
    analysis,
    whyItMatters: why,
    executiveImpact: why,
    riskImplication: why,
    recommendedAction: action,
    recommendation: action
  };
}

function executiveHeadline(grouped: Record<string, any[]>): string {
  const sec = grouped.SECURITY_INCIDENT || [];
  const high = sec.filter(i => (i.riskLevel || i.risk_level) === "high").length;
  const crit = sec.filter(i => (i.riskLevel || i.risk_level) === "critical").length;

  if (crit > 0) {
    return "A critical security issue requires immediate leadership visibility and response alignment.";
  }

  if (high > 0) {
    return "A high-severity security issue leads this cycle and should be reviewed promptly by security and risk leadership.";
  }

  return "This cycle is driven by governance and regulatory developments relevant to enterprise risk oversight.";
}

function sectionSummary(title: string, items: any[]): string {
  if (!items.length) {
    return `No material ${title.toLowerCase()} developments this cycle.`;
  }

  const high = items.filter(i => (i.riskLevel || i.risk_level) === "high").length;
  const crit = items.filter(i => (i.riskLevel || i.risk_level) === "critical").length;

  if (title === "Security Incidents") {
    return `Security activity remains the primary concern, with ${crit} critical and ${high} high-severity issue(s).`;
  }

  if (title === "AI Governance") {
    return `AI governance activity continues to evolve, with ${items.length} development(s) requiring oversight consideration.`;
  }

  if (title === "Regulations") {
    return `Regulatory developments remain active, with ${items.length} update(s) affecting compliance posture.`;
  }

  return `${items.length} development(s) identified.`;
}

export function applyExecutiveEditorialPass(issue: any) {
  const sections = issue.sections || {};

  const rewritten = {
    aiGovernance: (sections.aiGovernance || []).map(rewriteItem),
    securityIncidents: (sections.securityIncidents || []).map(rewriteItem),
    regulations: (sections.regulations || []).map(rewriteItem),
    vendorRisk: (sections.vendorRisk || []).map(rewriteItem),
    compliance: (sections.compliance || []).map(rewriteItem),
    general: (sections.general || []).map(rewriteItem)
  };

  const grouped = {
    AI_GOVERNANCE: rewritten.aiGovernance,
    SECURITY_INCIDENT: rewritten.securityIncidents,
    REGULATION: rewritten.regulations,
    VENDOR_RISK: rewritten.vendorRisk,
    COMPLIANCE_UPDATE: rewritten.compliance,
    GENERAL: rewritten.general
  };

  return {
    ...issue,
    executiveHeadline: executiveHeadline(grouped),
    executiveSummary: executiveHeadline(grouped),

    // REMOVE DUPLICATE DEPTH IN TOP SIGNALS
    topSignals: (issue.topSignals || []).map((i: any) => {
      const r = rewriteItem(i);
      return {
        ...r,
        analysis: "" // key improvement
      };
    }),

    summaries: {
      aiGovernance: sectionSummary("AI Governance", rewritten.aiGovernance),
      securityIncidents: sectionSummary("Security Incidents", rewritten.securityIncidents),
      regulations: sectionSummary("Regulations", rewritten.regulations),
      vendorRisk: sectionSummary("Vendor Risk", rewritten.vendorRisk),
      compliance: sectionSummary("Compliance", rewritten.compliance),
      general: sectionSummary("General", rewritten.general)
    },

    sections: rewritten
  };
}
