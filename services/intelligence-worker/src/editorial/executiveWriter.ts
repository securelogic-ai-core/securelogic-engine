function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function calculatePriority(item: any): number {
  let score = 0;
  const risk = (item.riskLevel || item.risk_level || "").toLowerCase();

  if (risk === "critical") score += 60;
  else if (risk === "high") score += 45;
  else if (risk === "medium") score += 25;

  return Math.min(100, score);
}

function priorityTier(score: number): string {
  if (score >= 70) return "IMMEDIATE";
  if (score >= 40) return "NEAR-TERM";
  return "MONITOR";
}

function directive(category: string): string {
  if (category === "SECURITY_INCIDENT") {
    return "Validate exposure and response readiness immediately.";
  }
  if (category === "REGULATION") {
    return "Review compliance alignment.";
  }
  if (category === "AI_GOVERNANCE") {
    return "Validate governance controls before expansion.";
  }
  return "Evaluate relevance.";
}

function rewriteItem(item: any): any {
  const category = clean(item.category || "GENERAL");
  const riskLevel = clean(item.riskLevel || item.risk_level || "low").toLowerCase();

  const score = calculatePriority({ riskLevel });

  return {
    ...item,
    category,
    riskLevel,
    priorityScore: score,
    priorityTier: priorityTier(score),
    directive: directive(category)
  };
}

function processSection(items: any[]) {
  if (!Array.isArray(items)) return [];
  return items.map(rewriteItem);
}

export function applyExecutiveEditorialPass(issue: any) {
  const sections = issue.sections || {};

  const updatedSections = {
    aiGovernance: processSection(sections.aiGovernance),
    securityIncidents: processSection(sections.securityIncidents),
    regulations: processSection(sections.regulations),
    vendorRisk: processSection(sections.vendorRisk),
    compliance: processSection(sections.compliance),
    general: processSection(sections.general)
  };

  // Flatten for top signals
  const all = Object.values(updatedSections).flat();

  const sorted = all.sort((a: any, b: any) => (b.priorityScore || 0) - (a.priorityScore || 0));

  return {
    ...issue,
    sections: updatedSections,
    topSignals: sorted.slice(0, 3),
    executiveSummary: "Priority-ranked intelligence requiring immediate and near-term attention."
  };
}
