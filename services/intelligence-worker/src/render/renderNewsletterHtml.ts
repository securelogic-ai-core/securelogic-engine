import fs from "fs/promises";

const FILE = "./data/newsletter.html";

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function riskColor(level: string) {
  if (level === "high") return "#b91c1c";
  if (level === "medium") return "#b45309";
  return "#166534";
}

function countRisk(items: any[], level: string) {
  return items.filter((i) => i.riskLevel === level).length;
}

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

function renderAudience(audience: string[]) {
  if (!audience || audience.length === 0) {
    return "";
  }

  return `
    <p style="margin:6px 0 0 0; font-size:13px; color:#374151;">
      <strong>Audience:</strong> ${escapeHtml(audience.join(", "))}
    </p>
  `;
}

function renderItemCard(item: any, includeCategory = false, compact = false) {
  return `
    <div style="border:1px solid #e5e7eb; border-radius:10px; padding:16px; margin:0 0 14px 0; background:#ffffff;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <h3 style="margin:0; font-size:18px; color:#111827;">
          ${escapeHtml(item.title)}
        </h3>
        <span style="
          display:inline-block;
          padding:4px 10px;
          border-radius:999px;
          font-size:12px;
          font-weight:700;
          color:#ffffff;
          background:${riskColor(item.riskLevel)};
          text-transform:uppercase;
        ">
          ${escapeHtml(item.riskLevel)}
        </span>
      </div>

      ${includeCategory ? `
        <p style="margin:8px 0 0 0; font-size:13px; color:#6b7280;">
          <strong>Category:</strong> ${escapeHtml(item.category || "GENERAL")}
        </p>
      ` : ""}

      ${renderAudience(item.audience)}

      <p style="margin:10px 0 0 0; font-size:14px; line-height:1.6; color:#1f2937;">
        <strong>Analysis:</strong> ${escapeHtml(item.analysis)}
      </p>

      ${compact ? "" : `
        <p style="margin:10px 0 0 0; font-size:14px; line-height:1.6; color:#1f2937;">
          <strong>Recommendation:</strong> ${escapeHtml(item.recommendation)}
        </p>
      `}
    </div>
  `;
}

function renderSection(title: string, summary: string, items: any[]) {
  let html = `
    <section style="margin:0 0 28px 0;">
      <h2 style="margin:0 0 10px 0; font-size:24px; color:#111827;">${escapeHtml(title)}</h2>
      <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#374151;">
        ${escapeHtml(summary)}
      </p>
  `;

  if (!items.length) {
    html += `
      <div style="border:1px dashed #d1d5db; border-radius:10px; padding:14px; background:#f9fafb; color:#6b7280; font-size:14px;">
        No additional items in this section.
      </div>
    `;
  } else {
    for (const item of items) {
      html += renderItemCard(item, false, false);
    }
  }

  html += `</section>`;
  return html;
}

export async function renderNewsletterHtml(issue: any) {
  const allItems = getAllItems(issue);

  const high = countRisk(allItems, "high");
  const medium = countRisk(allItems, "medium");
  const low = countRisk(allItems, "low");

  const topSignalIds = new Set((issue.topSignals || []).map((s: any) => s.signalId));

  const aiGovernance = (issue.sections.aiGovernance || []).filter((i: any) => !topSignalIds.has(i.signalId));
  const securityIncidents = (issue.sections.securityIncidents || []).filter((i: any) => !topSignalIds.has(i.signalId));
  const regulations = (issue.sections.regulations || []).filter((i: any) => !topSignalIds.has(i.signalId));
  const vendorRisk = (issue.sections.vendorRisk || []).filter((i: any) => !topSignalIds.has(i.signalId));
  const compliance = (issue.sections.compliance || []).filter((i: any) => !topSignalIds.has(i.signalId));
  const general = (issue.sections.general || []).filter((i: any) => !topSignalIds.has(i.signalId));

  const topSignalsHtml = (issue.topSignals || []).length
    ? issue.topSignals.map((item: any) => renderItemCard(item, true, true)).join("")
    : `
      <div style="border:1px dashed #d1d5db; border-radius:10px; padding:14px; background:#f9fafb; color:#6b7280; font-size:14px;">
        No priority signals identified.
      </div>
    `;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(issue.title)}</title>
</head>
<body style="margin:0; padding:0; background:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">
  <div style="max-width:920px; margin:0 auto; padding:28px 16px;">
    <div style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <div style="background:#111827; color:#ffffff; padding:28px 28px 20px 28px;">
        <h1 style="margin:0; font-size:32px;">${escapeHtml(issue.title)}</h1>
        <p style="margin:10px 0 0 0; font-size:14px; color:#d1d5db;">
          Created: ${escapeHtml(issue.createdAt)}
        </p>
      </div>

      <div style="padding:28px;">
        <section style="margin:0 0 28px 0;">
          <h2 style="margin:0 0 12px 0; font-size:24px; color:#111827;">Risk Snapshot</h2>
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <div style="background:#fee2e2; color:#991b1b; padding:14px 18px; border-radius:12px; font-weight:700;">
              High Risk Signals: ${high}
            </div>
            <div style="background:#fef3c7; color:#92400e; padding:14px 18px; border-radius:12px; font-weight:700;">
              Medium Risk Signals: ${medium}
            </div>
            <div style="background:#dcfce7; color:#166534; padding:14px 18px; border-radius:12px; font-weight:700;">
              Low Risk Signals: ${low}
            </div>
          </div>
        </section>

        <section style="margin:0 0 28px 0;">
          <h2 style="margin:0 0 10px 0; font-size:24px; color:#111827;">Executive Headline</h2>
          <p style="margin:0; font-size:16px; line-height:1.7; color:#1f2937;">
            ${escapeHtml(issue.executiveHeadline)}
          </p>
        </section>

        <section style="margin:0 0 28px 0;">
          <h2 style="margin:0 0 14px 0; font-size:24px; color:#111827;">Top Priority Signals</h2>
          ${topSignalsHtml}
        </section>

        ${renderSection("AI Governance", issue.summaries.aiGovernance, aiGovernance)}
        ${renderSection("Security Incidents", issue.summaries.securityIncidents, securityIncidents)}
        ${renderSection("Regulations", issue.summaries.regulations, regulations)}
        ${renderSection("Vendor Risk", issue.summaries.vendorRisk, vendorRisk)}
        ${renderSection("Compliance", issue.summaries.compliance, compliance)}
        ${renderSection("General", issue.summaries.general, general)}
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  await fs.writeFile(FILE, html, "utf8");
}