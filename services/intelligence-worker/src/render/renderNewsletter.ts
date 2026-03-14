import fs from "fs/promises";

const FILE = "./data/newsletter.md";

function getAllItems(issue: any) {
  return [
    ...issue.sections.aiGovernance,
    ...issue.sections.securityIncidents,
    ...issue.sections.regulations,
    ...issue.sections.vendorRisk,
    ...issue.sections.compliance,
    ...issue.sections.general
  ];
}

function countRisk(items: any[], level: string) {
  return items.filter((i) => i.riskLevel === level).length;
}

function renderRiskSnapshot(issue: any) {
  const items = getAllItems(issue);

  const high = countRisk(items, "high");
  const medium = countRisk(items, "medium");
  const low = countRisk(items, "low");

  return `
## Risk Snapshot

- High Risk Signals: ${high}
- Medium Risk Signals: ${medium}
- Low Risk Signals: ${low}

`;
}

function renderAudience(audience: string[]) {
  if (!audience || audience.length === 0) return "";
  return `- Audience: ${audience.join(", ")}\n`;
}

function renderTopSignals(topSignals: any[]) {
  let md = `## Top Priority Signals\n\n`;

  if (!topSignals.length) {
    md += "_No priority signals identified._\n\n";
    return md;
  }

  for (const item of topSignals) {
    md += `### ${item.title}\n`;
    md += `- Risk Level: ${item.riskLevel}\n`;
    md += `- Category: ${item.category}\n`;
    md += renderAudience(item.audience);
    md += `- Analysis: ${item.analysis}\n\n`;
  }

  return md;
}

function removeTopSignals(sectionItems: any[], topSignals: any[]) {
  const ids = new Set(topSignals.map((s) => s.signalId));

  return sectionItems.filter((item) => !ids.has(item.signalId));
}

function renderSection(title: string, summary: string, items: any[]) {
  let md = `## ${title}\n\n${summary}\n\n`;

  if (!items.length) {
    md += "_No additional items in this section._\n\n";
    return md;
  }

  for (const item of items) {
    md += `### ${item.title}\n`;
    md += `- Risk Level: ${item.riskLevel}\n`;
    md += renderAudience(item.audience);
    md += `- Analysis: ${item.analysis}\n`;
    md += `- Recommendation: ${item.recommendation}\n\n`;
  }

  return md;
}

export async function renderNewsletter(issue: any) {

  const aiGovernance = removeTopSignals(issue.sections.aiGovernance, issue.topSignals);
  const security = removeTopSignals(issue.sections.securityIncidents, issue.topSignals);
  const regulations = removeTopSignals(issue.sections.regulations, issue.topSignals);
  const vendorRisk = removeTopSignals(issue.sections.vendorRisk, issue.topSignals);
  const compliance = removeTopSignals(issue.sections.compliance, issue.topSignals);
  const general = removeTopSignals(issue.sections.general, issue.topSignals);

  let md = `# ${issue.title}\n\n`;
  md += `**Created:** ${issue.createdAt}\n\n`;

  md += renderRiskSnapshot(issue);

  md += `## Executive Headline\n\n${issue.executiveHeadline}\n\n`;

  md += renderTopSignals(issue.topSignals);

  md += renderSection("AI Governance", issue.summaries.aiGovernance, aiGovernance);

  md += renderSection("Security Incidents", issue.summaries.securityIncidents, security);

  md += renderSection("Regulations", issue.summaries.regulations, regulations);

  md += renderSection("Vendor Risk", issue.summaries.vendorRisk, vendorRisk);

  md += renderSection("Compliance", issue.summaries.compliance, compliance);

  md += renderSection("General", issue.summaries.general, general);

  await fs.writeFile(FILE, md);
}
