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

function riskColor(level: string): string {
  const l = normalizeText(level).toLowerCase();
  if (l === "critical") return "#dc2626";
  if (l === "high")     return "#ea580c";
  if (l === "medium")   return "#ca8a04";
  return "#16a34a";
}

function riskPillStyle(level: string): string {
  const l = normalizeText(level).toLowerCase();
  if (l === "critical") return "background:#fef2f2;color:#991b1b;border:1px solid #fecaca;";
  if (l === "high")     return "background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;";
  if (l === "medium")   return "background:#fefce8;color:#854d0e;border:1px solid #fde68a;";
  return "background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;";
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
  return normalizeText(item.recommendedAction || item.recommendation || "");
}

function renderCard(item: any) {
  const risk        = normalizeText(item.riskLevel ?? item.risk_level ?? "low");
  const whyItMatters = resolveWhyItMatters(item);
  const action      = resolveAction(item);
  const sourceUrl   = normalizeText(item.sourceUrl ?? item.source_url ?? "");
  const source      = normalizeText(item.source ?? "");

  return `
<div style="border:1px solid #e5e7eb;border-left:4px solid ${riskColor(risk)};border-radius:8px;padding:16px 20px;margin-bottom:12px;background:#ffffff;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;">
    <div style="font-size:15px;font-weight:700;color:#111827;line-height:1.4;flex:1;">
      ${escapeHtml(item.title)}
    </div>
    <span style="flex-shrink:0;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:0.05em;text-transform:uppercase;${riskPillStyle(risk)}">
      ${escapeHtml(risk)}
    </span>
  </div>

  <div style="font-size:11px;color:#9ca3af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em;">
    ${escapeHtml(item.category ?? "GENERAL")}
  </div>

  ${whyItMatters ? `
  <div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:8px;">
    <strong style="color:#111827;">Why it matters:</strong> ${escapeHtml(whyItMatters)}
  </div>` : ""}

  ${action ? `
  <div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:8px;">
    <strong style="color:#111827;">Action:</strong> ${escapeHtml(action)}
  </div>` : ""}

  ${sourceUrl ? `
  <div style="margin-top:10px;padding-top:10px;border-top:1px solid #f3f4f6;">
    <a href="${escapeHtml(sourceUrl)}" style="font-size:12px;color:#0d9488;text-decoration:none;" target="_blank" rel="noopener">
      ${escapeHtml(source || "View source")} →
    </a>
  </div>` : ""}
</div>`;
}

function renderSection(title: string, items: any[]) {
  if (!items?.length) return "";

  const sectionAccent: Record<string, string> = {
    "Top Signals":        "#0d9488",
    "AI Governance":      "#7c3aed",
    "Security Incidents": "#dc2626",
    "Regulatory Changes": "#2563eb",
    "Vendor Risk":        "#ea580c",
    "Compliance":         "#0891b2",
  };
  const accent = sectionAccent[title] ?? "#374151";

  return `
<div style="margin-top:28px;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
    <div style="width:4px;height:20px;background:${accent};border-radius:2px;flex-shrink:0;"></div>
    <div style="font-size:16px;font-weight:700;color:#111827;">${escapeHtml(title)}</div>
  </div>
  ${items.map(renderCard).join("")}
</div>`;
}

function buildRiskSnapshot(issue: any): string {
  const allItems = [
    ...(issue.topSignals ?? []),
    ...(issue.sections?.aiGovernance ?? []),
    ...(issue.sections?.securityIncidents ?? []),
    ...(issue.sections?.regulations ?? []),
    ...(issue.sections?.vendorRisk ?? []),
    ...(issue.sections?.compliance ?? []),
    ...(issue.sections?.general ?? []),
  ];

  // Dedupe by title
  const seen = new Set<string>();
  const unique = allItems.filter((i) => {
    if (seen.has(i.title)) return false;
    seen.add(i.title);
    return true;
  });

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of unique) {
    const level = normalizeText(item.riskLevel ?? item.risk_level ?? "low").toLowerCase();
    if (level === "critical") counts.critical++;
    else if (level === "high") counts.high++;
    else if (level === "medium") counts.medium++;
    else counts.low++;
  }

  const total = unique.length;
  if (total === 0) return "";

  const pills = [
    counts.critical > 0
      ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px 16px;border-radius:8px;font-weight:700;font-size:14px;white-space:nowrap;">${counts.critical} Critical</div>`
      : "",
    counts.high > 0
      ? `<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:12px 16px;border-radius:8px;font-weight:700;font-size:14px;white-space:nowrap;">${counts.high} High</div>`
      : "",
    counts.medium > 0
      ? `<div style="background:#fefce8;border:1px solid #fde68a;color:#854d0e;padding:12px 16px;border-radius:8px;font-weight:700;font-size:14px;white-space:nowrap;">${counts.medium} Medium</div>`
      : "",
    counts.low > 0
      ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:12px 16px;border-radius:8px;font-weight:700;font-size:14px;white-space:nowrap;">${counts.low} Low</div>`
      : "",
  ].filter(Boolean).join("");

  return `
<div style="margin-bottom:24px;">
  <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">
    Risk Snapshot — ${total} signal${total !== 1 ? "s" : ""} this issue
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;">${pills}</div>
</div>`;
}

export async function renderNewsletterHtml(issue: any) {
  const sections = issue.sections ?? {};

  const dateStr = issue.createdAt
    ? new Date(issue.createdAt).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

  const appUrl = (process.env.NEWSLETTER_APP_URL ?? "").trim().replace(/\/$/, "");

  const riskSnapshot = buildRiskSnapshot(issue);

  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(issue.title || "SecureLogic AI Intelligence Brief")}</title>
</head>

<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;">
<div style="font-size:0;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(issue.executiveSummary || issue.executiveHeadline || "Weekly risk intelligence from SecureLogic AI.")}</div>

<div style="max-width:680px;margin:0 auto;padding:24px 16px 48px;">

  <!-- Header -->
  <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 32px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <div style="font-size:11px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">
          SecureLogic AI
        </div>
        <div style="font-size:22px;font-weight:800;color:#ffffff;line-height:1.2;">
          Intelligence Brief
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;color:#94a3b8;">${escapeHtml(dateStr)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;font-style:italic;">
          ${issue.signalCount ? `${issue.signalCount} signals analyzed` : "Enterprise Risk Intelligence"}
        </div>
      </div>
    </div>
  </div>

  <!-- Executive summary bar -->
  <div style="background:#f8fafc;border-left:4px solid #0d9488;padding:16px 24px 16px 20px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">
      Executive Takeaway
    </div>
    <div style="font-size:15px;font-weight:600;color:#111827;line-height:1.5;">
      ${escapeHtml(issue.executiveSummary || issue.executiveHeadline || "")}
    </div>
  </div>

  <!-- Body -->
  <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:28px 32px;">

    ${riskSnapshot}

    ${renderSection("Top Signals", issue.topSignals || [])}
    ${renderSection("AI Governance", sections.aiGovernance)}
    ${renderSection("Security Incidents", sections.securityIncidents)}
    ${renderSection("Regulatory Changes", sections.regulations)}
    ${renderSection("Vendor Risk", sections.vendorRisk)}
    ${renderSection("Compliance", sections.compliance)}

    <!-- Footer -->
    <div style="margin-top:36px;padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:12px;color:#9ca3af;line-height:2.2;">
        <strong style="color:#374151;">SecureLogic AI</strong> — Enterprise Risk Intelligence<br />
        <a href="##VIEW_BRIEF_URL##" style="color:#0d9488;text-decoration:none;">View this brief online</a>
        &nbsp;&middot;&nbsp;
        ${appUrl ? `<a href="${escapeHtml(appUrl)}/account" style="color:#0d9488;text-decoration:none;">Manage subscription</a>
        &nbsp;&middot;&nbsp;` : ""}
        <a href="##UNSUBSCRIBE_URL##" style="color:#9ca3af;text-decoration:none;">Unsubscribe</a>
      </div>
    </div>

  </div>

</div>

</body>
</html>`.trim();
}
