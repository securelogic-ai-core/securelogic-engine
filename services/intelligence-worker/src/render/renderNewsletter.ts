function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function renderAudience(audience: unknown) {
  if (Array.isArray(audience) && audience.length > 0) {
    return `Audience: ${audience.join(", ")}`;
  }

  if (typeof audience === "string" && audience.trim().length > 0) {
    return `Audience: ${audience.trim()}`;
  }

  return "";
}

function renderRiskLine(item: any) {
  const category = normalizeText(item.category || "GENERAL");
  const riskLevel = normalizeText(item.riskLevel || item.risk_level || "low");

  return `Risk Level: ${riskLevel} | Category: ${category}`;
}

/**
 * EXECUTIVE PRIORITY BLOCK (CORE UPGRADE)
 */
function renderPriority(item: any) {
  const tier = normalizeText(item.priorityTier || "MONITOR");
  const score = item.priorityScore ?? "-";

  return `Priority: ${tier} (${score})`;
}

/**
 * DECISION DIRECTIVE (MOST IMPORTANT LINE)
 */
function renderDirective(item: any) {
  const directive = normalizeText(item.directive);

  if (!directive) return "";

  return `Directive: ${directive}`;
}

/**
 * FULL EXECUTIVE INSIGHT BLOCK
 */
function renderInsightBlock(item: any) {
  const title = normalizeText(item.title || "Untitled");

  const analysis = normalizeText(item.analysis || item.summary || "");

  const riskImplication = normalizeText(
    item.executiveImpact ||
    item.riskImplication ||
    item.risk_implication ||
    item.whyItMatters ||
    ""
  );

  const recommendation = normalizeText(
    item.recommendation ||
    item.recommendedAction ||
    ""
  );

  const audience = renderAudience(item.audience);

  return [
    `### ${title}`,
    "",
    renderPriority(item),
    renderRiskLine(item),
    audience,
    "",
    renderDirective(item),
    "",
    analysis ? `Analysis: ${analysis}` : "",
    riskImplication ? `Why it matters: ${riskImplication}` : "",
    recommendation ? `Recommended action: ${recommendation}` : "",
    ""
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * TOP SIGNALS (NO FILLER TEXT)
 */
function renderTopSignals(topSignals: any[]) {
  if (!Array.isArray(topSignals) || topSignals.length === 0) {
    return "## Top Signals\n\nNo top signals available.\n";
  }

  return [
    "## Top Signals",
    "",
    ...topSignals.map((signal) => renderInsightBlock(signal))
  ].join("\n");
}

function renderSection(title: string, items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return [
      `## ${title}`,
      "",
      "No items in this section.",
      ""
    ].join("\n");
  }

  return [
    `## ${title}`,
    "",
    ...items.map((item) => renderInsightBlock(item))
  ].join("\n");
}

export async function renderNewsletter(issue: any) {
  const sections = issue.sections ?? {};

  return [
    `# ${normalizeText(issue.title || "SecureLogic Intelligence Brief")}`,
    "",
    normalizeText(issue.executiveSummary || issue.executiveHeadline || ""),
    "",
    renderTopSignals(issue.topSignals ?? []),
    "",
    renderSection("AI Governance", sections.aiGovernance ?? []),
    "",
    renderSection("Security Incidents", sections.securityIncidents ?? []),
    "",
    renderSection("Regulations", sections.regulations ?? []),
    "",
    renderSection("Vendor Risk", sections.vendorRisk ?? []),
    "",
    renderSection("Compliance", sections.compliance ?? []),
    "",
    renderSection("General", sections.general ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}
