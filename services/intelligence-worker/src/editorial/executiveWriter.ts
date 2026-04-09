/**
 * executiveWriter.ts
 *
 * Editorial pass applied to a built newsletter issue before rendering.
 *
 * Responsibilities:
 * - Calculate priority scores and tiers for all signals
 * - Normalize signal metadata fields (category, riskLevel)
 * - Re-sort top signals by priority score
 * - Pass through LLM-generated content untouched (synthesis, cross-domain, action summary)
 *
 * What this file intentionally does NOT do:
 * - Generate template "why it matters" strings (removed)
 * - Generate template action strings (removed)
 * - Generate template executive summaries (removed)
 * - Overwrite LLM-generated content with weaker fallback text
 *
 * If a signal reaches this pass with empty analysis/action fields, those fields
 * remain empty. The rendering layer will omit empty fields rather than fill
 * them with placeholder text.
 */

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculatePriority(item: any): number {
  let score = 0;
  const risk = clean(item.riskLevel || item.risk_level || "").toLowerCase();
  const title = clean(item.title || "").toLowerCase();
  const analysis = clean(item.analysis || "").toLowerCase();
  const category = clean(item.category || "GENERAL").toUpperCase();

  if (risk === "critical") score += 60;
  else if (risk === "high") score += 45;
  else if (risk === "medium") score += 25;
  else score += 10;

  const urgencyKeywords = [
    "actively exploited", "active exploitation", "exploit", "breach",
    "zero-day", "emergency", "immediate", "urgent", "critical patch"
  ];
  if (urgencyKeywords.some((kw) => title.includes(kw) || analysis.includes(kw))) {
    score += 20;
  }

  const sensitivityKeywords = [
    "credential", "identity", "authentication", "data leak",
    "personal data", "pii", "pci", "phi"
  ];
  if (sensitivityKeywords.some((kw) => title.includes(kw) || analysis.includes(kw))) {
    score += 15;
  }

  const widespreadKeywords = [
    "widespread", "millions", "global", "enterprise-wide", "supply chain",
    "third-party", "vendor", "cloud"
  ];
  if (widespreadKeywords.some((kw) => title.includes(kw) || analysis.includes(kw))) {
    score += 10;
  }

  // Regulatory and governance items are important but rarely require 24h response
  if (category === "REGULATION" || category === "AI_GOVERNANCE") {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

function priorityTier(score: number): string {
  if (score >= 70) return "IMMEDIATE";
  if (score >= 40) return "NEAR-TERM";
  return "MONITOR";
}

function processSignal(item: any): any {
  const category = clean(item.category || "GENERAL").toUpperCase();
  const riskLevel = clean(item.riskLevel || item.risk_level || "low").toLowerCase();
  const priorityScore = calculatePriority({ ...item, category, riskLevel });

  return {
    ...item,
    category,
    riskLevel,
    risk_level: riskLevel,
    priorityScore,
    priorityTier: priorityTier(priorityScore)
  };
}

function processSection(items: any[]) {
  if (!Array.isArray(items)) return [];
  return items.map(processSignal);
}

export function applyExecutiveEditorialPass(issue: any) {
  const sections = issue.sections ?? {};

  const updatedSections = {
    aiGovernance: processSection(sections.aiGovernance),
    securityIncidents: processSection(sections.securityIncidents),
    regulations: processSection(sections.regulations),
    vendorRisk: processSection(sections.vendorRisk),
    compliance: processSection(sections.compliance)
  };

  const all = Object.values(updatedSections)
    .flat()
    .sort((a: any, b: any) => (b.priorityScore || 0) - (a.priorityScore || 0));

  // Re-select top 3 after priority scoring — they may differ from builder's selection
  const topSignals = all.slice(0, 3).map(processSignal);

  return {
    ...issue,
    sections: updatedSections,
    topSignals,
    // Pass through LLM-generated brief-level content unchanged
    executiveSummary: issue.executiveSummary ?? null,
    thesisHeadline: issue.thesisHeadline ?? null,
    crossDomainAnalysis: issue.crossDomainAnalysis ?? null,
    actionSummary: issue.actionSummary ?? null
  };
}
