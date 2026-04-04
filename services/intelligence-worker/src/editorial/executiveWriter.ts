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

function compressAnalysis(title: string, analysis: string, category: string): string {
  let text = stripAiTone(clean(analysis));

  text = removeQuotedTitle(text, title);

  if (!text) {
    if (category === "SECURITY_INCIDENT") {
      return "Indicates active threat activity requiring validation of exposure and defensive coverage.";
    }
    if (category === "REGULATION") {
      return "Signals regulatory change requiring review of governance and compliance alignment.";
    }
    if (category === "AI_GOVERNANCE") {
      return "Signals governance pressure on AI usage, oversight, and control maturity.";
    }
    return "Requires evaluation for enterprise exposure and control impact.";
  }

  // shorten long generic phrasing
  if (text.length > 240) {
    text = text.split(". ")[0] + ".";
  }

  return sentenceCase(text);
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
    topSignals: (issue.topSignals || []).map(rewriteItem),
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
