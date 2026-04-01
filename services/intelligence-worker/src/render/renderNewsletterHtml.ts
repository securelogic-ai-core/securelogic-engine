function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAudience(audience: unknown) {
  if (Array.isArray(audience)) {
    return `
      <div><strong>Audience:</strong> ${escapeHtml(audience.join(", "))}</div>
    `;
  }

  if (typeof audience === "string" && audience.trim().length > 0) {
    return `
      <div><strong>Audience:</strong> ${escapeHtml(audience)}</div>
    `;
  }

  return "";
}

function renderItemCard(item: any) {
  const title = item.title ?? "Untitled";
  const riskLevel = item.riskLevel ?? item.risk_level ?? "low";
  const analysis = item.analysis ?? item.summary ?? "";
  const recommendation = item.recommendation ?? "";

  return `
    <div style="border:1px solid #d1d5db;border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="font-weight:700;font-size:16px;margin-bottom:8px;">
        ${escapeHtml(title)}
      </div>
      <div><strong>Risk Level:</strong> ${escapeHtml(riskLevel)}</div>
      ${renderAudience(item.audience)}
      ${
        analysis
          ? `<div style="margin-top:8px;"><strong>Analysis:</strong> ${escapeHtml(analysis)}</div>`
          : ""
      }
      ${
        recommendation
          ? `<div style="margin-top:8px;"><strong>Recommendation:</strong> ${escapeHtml(recommendation)}</div>`
          : ""
      }
    </div>
  `;
}

function renderSection(title: string, items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return `
      <h2>${escapeHtml(title)}</h2>
      <p>No items in this section.</p>
    `;
  }

  return `
    <h2>${escapeHtml(title)}</h2>
    ${items.map((item) => renderItemCard(item)).join("")}
  `;
}

export async function renderNewsletterHtml(issue: any) {
  const sections = issue.sections ?? {};

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(issue.title ?? "SecureLogic Intelligence Brief")}</title>
</head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:900px;margin:0 auto;padding:24px;">
  <h1>${escapeHtml(issue.title ?? "SecureLogic Intelligence Brief")}</h1>
  <p>${escapeHtml(issue.executiveHeadline ?? "")}</p>

  <h2>Top Signals</h2>
  ${(issue.topSignals ?? []).map((item: any) => renderItemCard(item)).join("")}

  ${renderSection("AI Governance", sections.aiGovernance ?? [])}
  ${renderSection("Security Incidents", sections.securityIncidents ?? [])}
  ${renderSection("Regulations", sections.regulations ?? [])}
  ${renderSection("Vendor Risk", sections.vendorRisk ?? [])}
  ${renderSection("Compliance", sections.compliance ?? [])}
  ${renderSection("General", sections.general ?? [])}
</body>
</html>
  `.trim();
}