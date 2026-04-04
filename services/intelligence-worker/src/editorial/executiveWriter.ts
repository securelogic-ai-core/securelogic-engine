function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stripAiPhrases(value: string): string {
  return clean(
    value
      .replace(/^the event reported in\s+/i, "")
      .replace(/^the development reported in\s+/i, "")
      .replace(/^this (event|development)\s+/i, "")
      .replace(/\bhighlights\b/gi, "signals")
      .replace(/\bmay increase\b/gi, "raises")
      .replace(/\bshould evaluate\b/gi, "should assess")
      .replace(/\bthis is especially relevant where\b/gi, "This is most relevant where")
  );
}

function compactAnalysis(title: string, analysis: string, category: string, riskLevel: string): string {
  const base = stripAiPhrases(analysis);

  if (!base) {
    if (category === "SECURITY_INCIDENT") {
      return "This development warrants review for immediate exposure, control sufficiency, and business impact.";
    }

    if (category === "REGULATION") {
      return "This development warrants review for governance, documentation, and compliance impact.";
    }

    if (category === "AI_GOVERNANCE") {
      return "This development warrants review for AI oversight, policy alignment, and control maturity.";
    }

    return "This development warrants review for enterprise exposure and control impact.";
  }

  if (base.toLowerCase().startsWith(title.toLowerCase())) {
    return sentenceCase(base);
  }

  return sentenceCase(base);
}

function buildExecutiveHeadline(grouped: Record<string, any[]>): string {
  const securityHigh = grouped.SECURITY_INCIDENT?.filter((i) => (i.riskLevel || i.risk_level) === "high").length ?? 0;
  const securityCritical = grouped.SECURITY_INCIDENT?.filter((i) => (i.riskLevel || i.risk_level) === "critical").length ?? 0;
  const regulationCount = grouped.REGULATION?.length ?? 0;
  const aiCount = grouped.AI_GOVERNANCE?.length ?? 0;

  if (securityCritical > 0) {
    return "A critical security development leads this cycle and should be treated as an immediate decision item for security leadership.";
  }

  if (securityHigh > 1) {
    return "Multiple high-severity security developments define this cycle, with additional governance and regulatory implications requiring leadership attention.";
  }

  if (securityHigh === 1 && (regulationCount > 0 || aiCount > 0)) {
    return "One high-severity security issue leads this cycle, alongside governance and regulatory developments that merit executive review.";
  }

  if (securityHigh === 1) {
    return "One high-severity security issue leads this cycle and should be reviewed promptly by security and risk leadership.";
  }

  if (regulationCount > 0 || aiCount > 0) {
    return "This cycle is driven by governance and regulatory developments with direct implications for enterprise risk oversight.";
  }

  return "This cycle contains a limited set of developments that remain relevant for enterprise monitoring and control validation.";
}

function executiveSectionSummary(title: string, items: any[]): string {
  const count = items.length;
  const high = items.filter((i) => (i.riskLevel || i.risk_level) === "high").length;
  const critical = items.filter((i) => (i.riskLevel || i.risk_level) === "critical").length;

  if (count === 0) {
    if (title === "Security Incidents") return "No material security developments rose to briefing level in this cycle.";
    if (title === "AI Governance") return "No material AI governance developments rose to briefing level in this cycle.";
    if (title === "Regulations") return "No material regulatory developments rose to briefing level in this cycle.";
    if (title === "Vendor Risk") return "No material vendor-risk developments rose to briefing level in this cycle.";
    if (title === "Compliance") return "No material compliance developments rose to briefing level in this cycle.";
    return "No material developments rose to briefing level in this cycle.";
  }

  if (title === "Security Incidents") {
    return `Security remains the lead theme this cycle, with ${critical} critical and ${high} high-severity incident${high + critical === 1 ? "" : "s"} requiring review.`;
  }

  if (title === "AI Governance") {
    return `AI governance remains active, with ${count} development${count === 1 ? "" : "s"} relevant to oversight, policy, and control maturity.`;
  }

  if (title === "Regulations") {
    return `Regulatory activity remains relevant, with ${count} development${count === 1 ? "" : "s"} that may affect governance expectations or compliance posture.`;
  }

  if (title === "Vendor Risk") {
    return `Vendor-risk monitoring surfaced ${count} development${count === 1 ? "" : "s"} requiring third-party exposure review.`;
  }

  if (title === "Compliance") {
    return `Compliance monitoring surfaced ${count} development${count === 1 ? "" : "s"} requiring control or documentation review.`;
  }

  return `${count} development${count === 1 ? "" : "s"} rose to briefing level in this cycle.`;
}

function rewriteItem(item: any): any {
  const title = clean(item.title);
  const category = clean(item.category || "GENERAL");
  const riskLevel = clean(item.riskLevel || item.risk_level || "low").toLowerCase();

  const whyItMatters = clean(
    item.whyItMatters ||
    item.executiveImpact ||
    item.riskImplication ||
    item.risk_implication ||
    ""
  );

  const recommendedAction = clean(
    item.recommendedAction ||
    item.recommendation ||
    ""
  );

  const analysis = compactAnalysis(title, clean(item.analysis || item.summary || ""), category, riskLevel);

  return {
    ...item,
    title,
    category,
    riskLevel,
    risk_level: riskLevel,
    analysis,
    whyItMatters,
    executiveImpact: whyItMatters,
    riskImplication: whyItMatters,
    risk_implication: whyItMatters,
    recommendedAction,
    recommendation: recommendedAction
  };
}

export function applyExecutiveEditorialPass(issue: any) {
  const sections = issue.sections ?? {};

  const rewrittenSections = {
    aiGovernance: (sections.aiGovernance ?? []).map(rewriteItem),
    securityIncidents: (sections.securityIncidents ?? []).map(rewriteItem),
    regulations: (sections.regulations ?? []).map(rewriteItem),
    vendorRisk: (sections.vendorRisk ?? []).map(rewriteItem),
    compliance: (sections.compliance ?? []).map(rewriteItem),
    general: (sections.general ?? []).map(rewriteItem)
  };

  const groupedForHeadline = {
    AI_GOVERNANCE: rewrittenSections.aiGovernance,
    SECURITY_INCIDENT: rewrittenSections.securityIncidents,
    REGULATION: rewrittenSections.regulations,
    VENDOR_RISK: rewrittenSections.vendorRisk,
    COMPLIANCE_UPDATE: rewrittenSections.compliance,
    GENERAL: rewrittenSections.general
  };

  return {
    ...issue,
    executiveHeadline: buildExecutiveHeadline(groupedForHeadline),
    executiveSummary: buildExecutiveHeadline(groupedForHeadline),
    topSignals: (issue.topSignals ?? []).map(rewriteItem),
    summaries: {
      aiGovernance: executiveSectionSummary("AI Governance", rewrittenSections.aiGovernance),
      securityIncidents: executiveSectionSummary("Security Incidents", rewrittenSections.securityIncidents),
      regulations: executiveSectionSummary("Regulations", rewrittenSections.regulations),
      vendorRisk: executiveSectionSummary("Vendor Risk", rewrittenSections.vendorRisk),
      compliance: executiveSectionSummary("Compliance", rewrittenSections.compliance),
      general: executiveSectionSummary("General", rewrittenSections.general)
    },
    sections: rewrittenSections
  };
}
