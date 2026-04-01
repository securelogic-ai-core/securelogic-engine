function renderAudience(audience: unknown) {
  if (Array.isArray(audience)) {
    return `- Audience: ${audience.join(", ")}\n`;
  }

  if (typeof audience === "string" && audience.trim().length > 0) {
    return `- Audience: ${audience}\n`;
  }

  return "";
}

function renderTopSignals(topSignals: any[]) {
  if (!Array.isArray(topSignals) || topSignals.length === 0) {
    return "## Top Signals\n\nNo top signals available.\n";
  }

  const items = topSignals
    .map((signal) => {
      const title = signal.title ?? "Untitled";
      const category = signal.category ?? "GENERAL";
      const riskLevel = signal.riskLevel ?? signal.risk_level ?? "low";
      const analysis = signal.analysis ?? signal.summary ?? "";
      const recommendation = signal.recommendation ?? "";

      return [
        `### ${title}`,
        `- Category: ${category}`,
        `- Risk Level: ${riskLevel}`,
        renderAudience(signal.audience),
        analysis ? `- Analysis: ${analysis}` : "",
        recommendation ? `- Recommendation: ${recommendation}` : "",
        ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `## Top Signals\n\n${items}\n`;
}

function renderSection(title: string, items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return `## ${title}\n\nNo items in this section.\n`;
  }

  const body = items
    .map((item) => {
      const itemTitle = item.title ?? "Untitled";
      const riskLevel = item.riskLevel ?? item.risk_level ?? "low";
      const analysis = item.analysis ?? item.summary ?? "";
      const recommendation = item.recommendation ?? "";

      return [
        `### ${itemTitle}`,
        `- Risk Level: ${riskLevel}`,
        renderAudience(item.audience),
        analysis ? `- Analysis: ${analysis}` : "",
        recommendation ? `- Recommendation: ${recommendation}` : "",
        ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `## ${title}\n\n${body}\n`;
}

export async function renderNewsletter(issue: any) {
  const sections = issue.sections ?? {};

  return [
    `# ${issue.title ?? "SecureLogic Intelligence Brief"}`,
    "",
    issue.executiveHeadline ?? "",
    "",
    renderTopSignals(issue.topSignals ?? []),
    renderSection("AI Governance", sections.aiGovernance ?? []),
    renderSection("Security Incidents", sections.securityIncidents ?? []),
    renderSection("Regulations", sections.regulations ?? []),
    renderSection("Vendor Risk", sections.vendorRisk ?? []),
    renderSection("Compliance", sections.compliance ?? []),
    renderSection("General", sections.general ?? [])
  ].join("\n");
}