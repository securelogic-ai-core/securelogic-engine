import { getInsights } from "../storage/postgresInsightStore.js";

function riskRank(level: string) {
  if (level === "critical") return 4;
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function normalizeCategory(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();

  if (!raw) return "GENERAL";
  if (raw.includes("AI")) return "AI_GOVERNANCE";
  if (raw.includes("SECURITY")) return "SECURITY_INCIDENT";
  if (raw.includes("REGULATION")) return "REGULATION";
  if (raw.includes("VENDOR")) return "VENDOR_RISK";
  if (raw.includes("COMPLIANCE")) return "COMPLIANCE_UPDATE";

  return "GENERAL";
}

function dedupeInsights(insights: any[]) {
  const seen = new Map<string, any>();

  for (const insight of insights) {
    const key = insight.signal_id || insight.signalId || insight.id;
    if (!key) continue;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, insight);
      continue;
    }

    const existingRank = riskRank(existing.risk_level || existing.riskLevel || "low");
    const currentRank = riskRank(insight.risk_level || insight.riskLevel || "low");

    if (currentRank >= existingRank) {
      seen.set(key, insight);
    }
  }

  return Array.from(seen.values());
}

function sortByPriority(items: any[]) {
  return items.sort(
    (a, b) =>
      riskRank(b.risk_level || b.riskLevel || "low") -
      riskRank(a.risk_level || a.riskLevel || "low")
  );
}

function sourceTextForRules(insight: any): string {
  return `${insight.title || ""} ${insight.summary || ""}`.toLowerCase();
}

function buildWhyItMatters(insight: any): string {
  const text = sourceTextForRules(insight);
  const risk = String(insight.riskLevel || insight.risk_level || "low").toLowerCase();
  const category = normalizeCategory(insight.category);

  if (
    text.includes("zero-day") ||
    text.includes("actively exploited") ||
    text.includes("under active exploitation") ||
    text.includes("exploit")
  ) {
    return "Active exploitation risk increases the likelihood of immediate enterprise exposure if affected systems are present.";
  }

  if (
    text.includes("wallet") ||
    text.includes("recovery phrase") ||
    text.includes("seed phrase") ||
    text.includes("crypto")
  ) {
    return "Indicates theft of high-value recovery data that can result in irreversible asset loss and broader trust impact if enterprise or customer devices are affected.";
  }

  if (
    text.includes("ios") ||
    text.includes("android") ||
    text.includes("mobile app") ||
    text.includes("app store") ||
    text.includes("play store")
  ) {
    return "Highlights mobile supply chain and endpoint trust risk, especially where employees install consumer or unvetted applications on enterprise-accessible devices.";
  }

  if (text.includes("credential") || text.includes("phishing")) {
    return "Elevates risk of credential theft, account compromise, and downstream unauthorized access across enterprise environments.";
  }

  if (
    text.includes("malware") ||
    text.includes("ransomware") ||
    text.includes("trojan") ||
    text.includes("backdoor")
  ) {
    return "Reflects active malicious tradecraft that could drive endpoint compromise, lateral movement, or operational disruption.";
  }

  if (category === "AI_GOVERNANCE") {
    return "Introduces governance, oversight, documentation, and policy alignment risk as enterprise AI adoption expands.";
  }

  if (category === "REGULATION") {
    return "May increase compliance obligations and introduce audit, enforcement, or governance exposure.";
  }

  if (risk === "critical") {
    return "Represents an urgent development with immediate potential for material enterprise impact if response lags.";
  }

  if (risk === "high") {
    return "Represents a high-priority development with potential business and security impact if unaddressed.";
  }

  return "Relevant to enterprise risk posture and should be evaluated for exposure, ownership, and control coverage.";
}

function buildRecommendedAction(insight: any): string {
  const text = sourceTextForRules(insight);
  const risk = String(insight.riskLevel || insight.risk_level || "low").toLowerCase();
  const category = normalizeCategory(insight.category);

  if (
    text.includes("wallet") ||
    text.includes("recovery phrase") ||
    text.includes("seed phrase") ||
    text.includes("crypto")
  ) {
    return "Review mobile application allowlisting, restrict untrusted app installation where feasible, and alert users to the risk of wallet or recovery-phrase theft through malicious apps.";
  }

  if (
    text.includes("ios") ||
    text.includes("android") ||
    text.includes("mobile app") ||
    text.includes("app store") ||
    text.includes("play store")
  ) {
    return "Validate mobile device management controls, review enterprise app trust policies, and determine whether affected apps or platforms require blocking, removal, or user notification.";
  }

  if (
    text.includes("zero-day") ||
    text.includes("patch") ||
    text.includes("actively exploited") ||
    text.includes("under active exploitation")
  ) {
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
    return "Validate endpoint coverage, review detections, and confirm response readiness for compromise scenarios tied to this activity.";
  }

  if (category === "AI_GOVERNANCE") {
    return "Review AI governance policies, approval workflows, model oversight, and acceptable use controls before broader deployment.";
  }

  if (category === "REGULATION") {
    return "Assess whether policies, governance documentation, reporting obligations, or control evidence should be updated.";
  }

  if (risk === "critical" || risk === "high") {
    return "Assign ownership immediately and determine whether escalation, mitigation, or executive visibility is required.";
  }

  return "Validate applicability and confirm that existing controls remain effective.";
}

function normalizeAudience(audience: unknown): string | string[] {
  if (Array.isArray(audience)) return audience;
  if (typeof audience === "string") return audience;
  return "";
}

function enrichInsight(insight: any) {
  const normalizedRisk = String(insight.riskLevel || insight.risk_level || "low").toLowerCase();
  const whyItMatters = buildWhyItMatters(insight);
  const recommendedAction = buildRecommendedAction(insight);

  return {
    ...insight,
    category: normalizeCategory(insight.category),
    riskLevel: normalizedRisk,
    risk_level: normalizedRisk,
    summary: insight.summary ?? insight.analysis ?? "",
    audience: normalizeAudience(insight.audience),
    whyItMatters,
    recommendedAction,
    executiveImpact: whyItMatters,
    riskImplication: whyItMatters,
    risk_implication: whyItMatters,
    recommendation: recommendedAction
  };
}

function groupByCategory(insights: any[]) {
  const grouped: Record<string, any[]> = {
    AI_GOVERNANCE: [],
    SECURITY_INCIDENT: [],
    REGULATION: [],
    VENDOR_RISK: [],
    COMPLIANCE_UPDATE: [],
    GENERAL: []
  };

  for (const insight of insights) {
    const category = normalizeCategory(insight.category);

    grouped[category].push({
      ...insight,
      category
    });
  }

  for (const key of Object.keys(grouped)) {
    grouped[key] = sortByPriority(grouped[key]);
  }

  return grouped;
}

function buildSectionSummary(title: string, items: any[]) {
  if (!items.length) {
    return `No significant ${title.toLowerCase()} signals were detected in this cycle.`;
  }

  const critical = items.filter(
    (i) => (i.risk_level || i.riskLevel) === "critical"
  ).length;

  const high = items.filter(
    (i) => (i.risk_level || i.riskLevel) === "high"
  ).length;

  const medium = items.filter(
    (i) => (i.risk_level || i.riskLevel) === "medium"
  ).length;

  if (title === "Security Incidents") {
    if (critical > 0 || high > 0) {
      return `Security activity remains the dominant theme this cycle, with ${critical} critical, ${high} high-risk, and ${medium} medium-risk incident(s) requiring attention.`;
    }
    return `Security activity remains elevated, with ${items.length} incident(s) identified this cycle.`;
  }

  if (title === "AI Governance") {
    return `AI governance developments continue to warrant attention, with ${items.length} relevant signal(s) identified this cycle.`;
  }

  if (title === "Regulations") {
    return `Regulatory developments remain active, with ${items.length} notable update(s) identified this cycle.`;
  }

  if (title === "Vendor Risk") {
    return `Vendor risk monitoring identified ${items.length} relevant signal(s) in this cycle.`;
  }

  if (title === "Compliance") {
    return `Compliance-related developments produced ${items.length} relevant signal(s) in this cycle.`;
  }

  return `${items.length} ${title.toLowerCase()} signal(s) identified, including ${critical} critical, ${high} high-risk, and ${medium} medium-risk item(s).`;
}

function buildExecutiveHeadline(grouped: Record<string, any[]>) {
  const securityCritical = grouped.SECURITY_INCIDENT.filter(
    (i) => (i.risk_level || i.riskLevel) === "critical"
  ).length;

  const securityHigh = grouped.SECURITY_INCIDENT.filter(
    (i) => (i.risk_level || i.riskLevel) === "high"
  ).length;

  const regulationCount = grouped.REGULATION.length;
  const aiCount = grouped.AI_GOVERNANCE.length;

  if (securityCritical >= 1) {
    return "A critical security development defines this cycle, with additional regulatory and AI governance signals increasing enterprise decision pressure.";
  }

  if (securityHigh >= 2) {
    return "Multiple high-risk security developments define this cycle, with additional regulatory and AI governance signals adding strategic risk considerations.";
  }

  if (securityHigh === 1) {
    return "A high-priority security development leads this cycle, alongside notable regulatory and AI governance activity.";
  }

  if (regulationCount > 0 || aiCount > 0) {
    return "This cycle is defined by a mix of regulatory, AI governance, and cybersecurity developments relevant to enterprise risk teams.";
  }

  return "This brief summarizes the most relevant SecureLogic intelligence signals for the current cycle.";
}

function buildTopSignals(insights: any[]) {
  return sortByPriority([...insights])
    .slice(0, 3)
    .map(enrichInsight);
}

export async function buildNewsletterIssue() {
  const insights = await getInsights(100);

  const normalized = insights.map((insight: any) => ({
    ...insight,
    signalId: insight.signal_id ?? insight.signalId,
    riskLevel: insight.risk_level ?? insight.riskLevel,
    category: normalizeCategory(insight.category),
    summary: insight.analysis ?? insight.summary ?? ""
  }));

  const deduped = dedupeInsights(normalized).map(enrichInsight);
  const grouped = groupByCategory(deduped);

  return {
    id: `NEWS-${Date.now()}`,
    title: "SecureLogic Intelligence Brief",
    createdAt: new Date().toISOString(),
    executiveHeadline: buildExecutiveHeadline(grouped),
    executiveSummary: buildExecutiveHeadline(grouped),
    topSignals: buildTopSignals(deduped),
    summaries: {
      aiGovernance: buildSectionSummary("AI Governance", grouped.AI_GOVERNANCE),
      securityIncidents: buildSectionSummary("Security Incidents", grouped.SECURITY_INCIDENT),
      regulations: buildSectionSummary("Regulations", grouped.REGULATION),
      vendorRisk: buildSectionSummary("Vendor Risk", grouped.VENDOR_RISK),
      compliance: buildSectionSummary("Compliance", grouped.COMPLIANCE_UPDATE),
      general: buildSectionSummary("General", grouped.GENERAL)
    },
    sections: {
      aiGovernance: grouped.AI_GOVERNANCE.slice(0, 3).map(enrichInsight),
      securityIncidents: grouped.SECURITY_INCIDENT.slice(0, 5).map(enrichInsight),
      regulations: grouped.REGULATION.slice(0, 3).map(enrichInsight),
      vendorRisk: grouped.VENDOR_RISK.slice(0, 3).map(enrichInsight),
      compliance: grouped.COMPLIANCE_UPDATE.slice(0, 3).map(enrichInsight),
      general: grouped.GENERAL.slice(0, 3).map(enrichInsight)
    }
  };
}
