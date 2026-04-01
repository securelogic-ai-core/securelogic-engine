import { getInsights } from "../storage/postgresInsightStore.js";

function riskRank(level: string) {
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

  const high = items.filter(
    (i) => (i.risk_level || i.riskLevel) === "high"
  ).length;

  const medium = items.filter(
    (i) => (i.risk_level || i.riskLevel) === "medium"
  ).length;

  if (title === "Security Incidents") {
    if (high > 0) {
      return `Security activity remains the dominant theme this cycle, with ${high} high-risk incident(s) and ${medium} medium-risk incident(s) requiring attention.`;
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

  return `${items.length} ${title.toLowerCase()} signal(s) identified, including ${high} high-risk and ${medium} medium-risk item(s).`;
}

function buildExecutiveHeadline(grouped: Record<string, any[]>) {
  const securityHigh = grouped.SECURITY_INCIDENT.filter(
    (i) => (i.risk_level || i.riskLevel) === "high"
  ).length;

  const regulationCount = grouped.REGULATION.length;
  const aiCount = grouped.AI_GOVERNANCE.length;

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
  return sortByPriority([...insights]).slice(0, 3);
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

  const deduped = dedupeInsights(normalized);
  const grouped = groupByCategory(deduped);

  return {
    id: `NEWS-${Date.now()}`,
    title: "SecureLogic Intelligence Brief",
    createdAt: new Date().toISOString(),
    executiveHeadline: buildExecutiveHeadline(grouped),
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
      aiGovernance: grouped.AI_GOVERNANCE.slice(0, 3),
      securityIncidents: grouped.SECURITY_INCIDENT.slice(0, 5),
      regulations: grouped.REGULATION.slice(0, 3),
      vendorRisk: grouped.VENDOR_RISK.slice(0, 3),
      compliance: grouped.COMPLIANCE_UPDATE.slice(0, 3),
      general: grouped.GENERAL.slice(0, 3)
    }
  };
}
