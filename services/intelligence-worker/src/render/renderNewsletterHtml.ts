function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function riskColor(level: string) {
  const l = normalizeText(level).toLowerCase();
  if (l === "critical") return "#dc2626";
  if (l === "high") return "#ea580c";
  if (l === "medium") return "#ca8a04";
  return "#16a34a";
}

function resolveWhyItMatters(item: any): string {
  return normalizeText(
    item.whyItMatters ||
    item.executiveImpact ||
    item.riskImplication ||
    item.risk_implication ||
    item.analysis ||
    item.summary ||
    ""
  );
}

function resolveAction(item: any): string {
  return normalizeText(
    item.recommendedAction ||
    item.recommendation ||
    ""
  );
}

function renderCard(item: any) {
  const risk = normalizeText(item.riskLevel ?? item.risk_level ?? "low");
  const whyItMatters = resolveWhyItMatters(item);
  const action = resolveAction(item);

  return `
  <div style="border-left:4px solid ${riskColor(risk)};padding:16px;margin-bottom:16px;background:#f9fafb;">
    <div style="font-size:18px;font-weight:700;margin-bottom:6px;">
      ${escapeHtml(item.title)}
    </div>

    <div style="font-size:12px;color:#6b7280;margin-bottom:8px;">
      ${escapeHtml(item.category ?? "GENERAL")} • ${escapeHtml(risk.toUpperCase())}
    </div>

    ${
      whyItMatters
        ? `<div style="margin-bottom:8px;"><strong>Why it matters:</strong> ${escapeHtml(whyItMatters)}</div>`
        : ""
    }

    ${
      action
        ? `<div><strong>Action:</strong> ${escapeHtml(action)}</div>`
        : ""
    }
  </div>
  `;
}

function renderSection(title: string, items: any[]) {
  if (!items?.length) return "";

  return `
    <div style="margin-top:32px;">
      <div style="font-size:20px;font-weight:700;border-bottom:2px solid #e5e7eb;margin-bottom:12px;">
        ${escapeHtml(title)}
      </div>
      ${items.map(renderCard).join("")}
    </div>
  `;
}

export async function renderNewsletterHtml(issue: any) {
  const sections = issue.sections ?? {};

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
</head>

<body style="font-family:-apple-system,system-ui;padding:32px;max-width:900px;margin:auto;color:#111827;">

  <div style="margin-bottom:24px;">
    <div style="font-size:28px;font-weight:800;">
      ${escapeHtml(issue.title || "SecureLogic Intelligence")}
    </div>

    <div style="margin-top:8px;font-size:16px;color:#374151;">
      ${escapeHtml(issue.executiveHeadline || "")}
    </div>
  </div>

  <div style="background:#111827;color:white;padding:16px;border-radius:8px;margin-bottom:24px;">
    <div style="font-size:14px;opacity:.7;">Executive Takeaway</div>
    <div style="font-size:16px;font-weight:600;">
      ${escapeHtml(issue.executiveSummary || issue.executiveHeadline || "")}
    </div>
  </div>

  ${renderSection("Top Risks", issue.topSignals || [])}

  ${renderSection("AI Governance", sections.aiGovernance)}
  ${renderSection("Security Incidents", sections.securityIncidents)}
  ${renderSection("Regulatory Changes", sections.regulations)}
  ${renderSection("Vendor Risk", sections.vendorRisk)}

</body>
</html>
`.trim();
}
