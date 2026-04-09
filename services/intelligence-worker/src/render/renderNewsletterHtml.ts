/**
 * renderNewsletterHtml.ts
 *
 * Renders the Intelligence Brief as an email-safe HTML document.
 *
 * Email layout (in order):
 *   [1] Header bar (logo wordmark, issue number, date, signal count)
 *   [2] Intelligence Synthesis (editorial opening — LLM-generated)
 *   [3] Priority Intelligence (top 3 signals — full cards with "Full analysis →" CTA)
 *   [4] Category sections (max 4, editorial framing, 2-3 signals each)
 *   [5] Intelligence Metrics bar (counts + week-over-week delta)
 *   [6] Footer (branding, view full brief, manage subscription, unsubscribe)
 *
 * What this template intentionally omits:
 *   - Risk Snapshot pill block (replaced by per-card pills + Metrics bar)
 *   - "General" category section
 *   - Duplicate signal listing (topSignals are NOT re-listed in category sections)
 *   - Source URL as primary CTA (source name only, secondary attribution)
 *   - Template executive summary sentences
 */

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

function formatCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    AI_GOVERNANCE:     "AI Governance",
    SECURITY_INCIDENT: "Security",
    REGULATION:        "Regulatory",
    VENDOR_RISK:       "Vendor Risk",
    COMPLIANCE_UPDATE: "Compliance"
  };
  return labels[category] ?? category;
}

// ---------------------------------------------------------------------------
// Priority signal card (email version — compact, with "Full analysis →" CTA)
// ---------------------------------------------------------------------------

function renderPriorityCard(item: any, appUrl: string) {
  const risk          = normalizeText(item.riskLevel ?? item.risk_level ?? "low");
  const category      = formatCategoryLabel(normalizeText(item.category ?? ""));
  const analysis      = normalizeText(item.whyItMatters || item.analysis || item.summary || "");
  const action        = normalizeText(item.recommendedAction || item.recommendation || "");
  const source        = normalizeText(item.source ?? "");
  const signalId      = normalizeText(item.id ?? item.signalId ?? item.signal_id ?? "");
  const issueFragment = signalId ? `#signal-${escapeHtml(signalId)}` : "";
  const briefUrl      = normalizeText(item.briefUrl ?? "");
  const fullAnalysisUrl = briefUrl
    ? escapeHtml(briefUrl)
    : appUrl
      ? `${escapeHtml(appUrl)}/briefs${issueFragment}`
      : "";

  return `
<div style="border:1px solid #e5e7eb;border-left:4px solid ${riskColor(risk)};border-radius:8px;padding:18px 22px;margin-bottom:14px;background:#ffffff;">

  <!-- Title row -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px;">
    <div style="font-size:15px;font-weight:700;color:#111827;line-height:1.4;flex:1;">
      ${escapeHtml(item.title)}
    </div>
    <span style="flex-shrink:0;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;letter-spacing:0.06em;text-transform:uppercase;${riskPillStyle(risk)}">
      ${escapeHtml(risk)}
    </span>
  </div>

  <!-- Category label -->
  <div style="font-size:11px;color:#9ca3af;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">
    ${escapeHtml(category)}
  </div>

  ${analysis ? `
  <!-- Analysis -->
  <div style="font-size:14px;color:#374151;line-height:1.65;margin-bottom:10px;">
    ${escapeHtml(analysis)}
  </div>` : ""}

  ${action ? `
  <!-- Action -->
  <div style="font-size:14px;color:#374151;line-height:1.65;margin-bottom:12px;">
    <strong style="color:#111827;">Action:</strong> ${escapeHtml(action)}
  </div>` : ""}

  <!-- CTA row: Full analysis → (primary) | source attribution (secondary) -->
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding-top:12px;border-top:1px solid #f3f4f6;">
    ${fullAnalysisUrl ? `
    <a href="${fullAnalysisUrl}" style="font-size:13px;font-weight:600;color:#0d9488;text-decoration:none;">
      Full analysis &rarr;
    </a>` : `<span></span>`}
    ${source ? `
    <span style="font-size:12px;color:#9ca3af;">
      ${escapeHtml(source)}
    </span>` : ""}
  </div>

</div>`;
}

// ---------------------------------------------------------------------------
// Category section signal card (compact — no "Full analysis →" CTA)
// ---------------------------------------------------------------------------

function renderCategoryCard(item: any) {
  const risk     = normalizeText(item.riskLevel ?? item.risk_level ?? "low");
  const category = formatCategoryLabel(normalizeText(item.category ?? ""));
  const analysis = normalizeText(item.whyItMatters || item.analysis || item.summary || "");
  const action   = normalizeText(item.recommendedAction || item.recommendation || "");
  const source   = normalizeText(item.source ?? "");

  return `
<div style="border:1px solid #e5e7eb;border-left:3px solid ${riskColor(risk)};border-radius:6px;padding:14px 18px;margin-bottom:10px;background:#ffffff;">

  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px;">
    <div style="font-size:14px;font-weight:700;color:#111827;line-height:1.4;flex:1;">
      ${escapeHtml(item.title)}
    </div>
    <span style="flex-shrink:0;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;letter-spacing:0.06em;text-transform:uppercase;${riskPillStyle(risk)}">
      ${escapeHtml(risk)}
    </span>
  </div>

  <div style="font-size:11px;color:#9ca3af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em;">
    ${escapeHtml(category)}
  </div>

  ${analysis ? `
  <div style="font-size:13px;color:#374151;line-height:1.6;margin-bottom:8px;">
    ${escapeHtml(analysis)}
  </div>` : ""}

  ${action ? `
  <div style="font-size:13px;color:#374151;line-height:1.6;">
    <strong style="color:#111827;">Action:</strong> ${escapeHtml(action)}
  </div>` : ""}

  ${source ? `
  <div style="margin-top:8px;padding-top:8px;border-top:1px solid #f9fafb;">
    <span style="font-size:11px;color:#9ca3af;">${escapeHtml(source)}</span>
  </div>` : ""}

</div>`;
}

// ---------------------------------------------------------------------------
// Category section
// ---------------------------------------------------------------------------

const SECTION_ACCENT: Record<string, string> = {
  aiGovernance:     "#7c3aed",
  securityIncidents:"#dc2626",
  regulations:      "#2563eb",
  vendorRisk:       "#ea580c",
  compliance:       "#0891b2"
};

const SECTION_LABELS: Record<string, string> = {
  aiGovernance:     "AI Governance",
  securityIncidents:"Security Incidents",
  regulations:      "Regulatory Changes",
  vendorRisk:       "Vendor Risk",
  compliance:       "Compliance"
};

/**
 * Render a category section. Excludes signals already shown in Priority
 * Intelligence (identified by title match) to prevent duplication.
 */
function renderCategorySection(
  sectionKey: string,
  items: any[],
  priorityTitles: Set<string>
) {
  // Filter out signals already shown in Priority Intelligence
  const filtered = (items ?? []).filter(
    (item) => !priorityTitles.has(normalizeText(item.title))
  );

  if (!filtered.length) return "";

  const accent = SECTION_ACCENT[sectionKey] ?? "#374151";
  const label  = SECTION_LABELS[sectionKey] ?? sectionKey;

  return `
<div style="margin-top:28px;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
    <div style="width:4px;height:20px;background:${accent};border-radius:2px;flex-shrink:0;"></div>
    <div style="font-size:15px;font-weight:700;color:#111827;">${escapeHtml(label)}</div>
  </div>
  ${filtered.map(renderCategoryCard).join("")}
</div>`;
}

// ---------------------------------------------------------------------------
// Intelligence Metrics bar
// ---------------------------------------------------------------------------

function buildMetricsBar(issue: any): string {
  const allItems = Object.values(issue.sections ?? {}).flat() as any[];
  const topSignals = issue.topSignals ?? [];

  // Dedupe by title across all sections + top signals
  const seen = new Set<string>();
  const unique = [...topSignals, ...allItems].filter((i) => {
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

  const parts: string[] = [`${total} signal${total !== 1 ? "s" : ""} analyzed`];
  if (counts.critical > 0) parts.push(`${counts.critical} Critical`);
  if (counts.high > 0) parts.push(`${counts.high} High`);
  if (counts.medium > 0) parts.push(`${counts.medium} Medium`);
  if (counts.low > 0) parts.push(`${counts.low} Low`);

  const nextBriefDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  })();

  return `
<div style="margin-top:28px;padding:14px 20px;background:#f8fafc;border-radius:8px;border:1px solid #e5e7eb;">
  <div style="font-size:12px;color:#6b7280;line-height:1.8;">
    ${parts.join(" &nbsp;&middot;&nbsp; ")} &nbsp;&middot;&nbsp; Next brief: ${nextBriefDate}
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export async function renderNewsletterHtml(issue: any) {
  const sections  = issue.sections ?? {};
  const topSignals: any[] = issue.topSignals ?? [];

  const dateStr = issue.createdAt
    ? new Date(issue.createdAt).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      })
    : new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });

  const appUrl = (process.env.NEWSLETTER_APP_URL ?? "").trim().replace(/\/$/, "");

  // Track top signal titles so category sections don't duplicate them
  const priorityTitles = new Set(topSignals.map((s) => normalizeText(s.title)));

  const issueNum = issue.issueNumber
    ? `Issue #${issue.issueNumber} &nbsp;&middot;&nbsp; `
    : "";

  const signalCountStr = issue.signalCount
    ? `${issue.signalCount} signals analyzed`
    : "Enterprise Risk Intelligence";

  const synthesis = normalizeText(issue.executiveSummary ?? "");
  const preheader = synthesis || "Weekly risk intelligence from SecureLogic AI.";

  // Only render category sections that have remaining signals (after priority dedup)
  const categorySections = [
    renderCategorySection("securityIncidents", sections.securityIncidents, priorityTitles),
    renderCategorySection("aiGovernance",      sections.aiGovernance,      priorityTitles),
    renderCategorySection("regulations",       sections.regulations,       priorityTitles),
    renderCategorySection("vendorRisk",        sections.vendorRisk,        priorityTitles),
    renderCategorySection("compliance",        sections.compliance,        priorityTitles)
  ].filter(Boolean).join("");

  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(issue.title || "SecureLogic AI Intelligence Brief")}</title>
</head>

<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;">

<!-- Preheader (hidden) -->
<div style="font-size:0;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>

<div style="max-width:680px;margin:0 auto;padding:24px 16px 48px;">

  <!-- [1] Header -->
  <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 32px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <div style="font-size:11px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">
          SecureLogic AI
        </div>
        <div style="font-size:22px;font-weight:800;color:#ffffff;line-height:1.2;">
          Intelligence Brief
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;color:#94a3b8;">${issueNum}${escapeHtml(dateStr)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;font-style:italic;">
          ${escapeHtml(signalCountStr)}
        </div>
      </div>
    </div>
  </div>

  <!-- Body wrapper -->
  <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:28px 32px;">

    ${synthesis ? `
    <!-- [2] Intelligence Synthesis -->
    <div style="border-left:4px solid #0d9488;padding:16px 20px;margin-bottom:28px;background:#f8fafc;border-radius:0 8px 8px 0;">
      <div style="font-size:11px;font-weight:700;color:#0d9488;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">
        Intelligence Synthesis
      </div>
      <div style="font-size:15px;color:#111827;line-height:1.7;font-weight:500;">
        ${escapeHtml(synthesis)}
      </div>
    </div>` : ""}

    ${topSignals.length ? `
    <!-- [3] Priority Intelligence -->
    <div style="margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="width:4px;height:20px;background:#0d9488;border-radius:2px;flex-shrink:0;"></div>
        <div style="font-size:15px;font-weight:700;color:#111827;">Requires Your Attention This Week</div>
      </div>
      ${topSignals.map((s) => renderPriorityCard(s, appUrl)).join("")}
    </div>` : ""}

    ${categorySections}

    ${buildMetricsBar(issue)}

    <!-- [6] Footer -->
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:12px;color:#9ca3af;line-height:2.4;">
        <strong style="color:#374151;">SecureLogic AI</strong> — Enterprise Risk Intelligence<br />
        <a href="##VIEW_BRIEF_URL##" style="color:#0d9488;text-decoration:none;font-weight:500;">View full brief &rarr;</a>
        &nbsp;&middot;&nbsp;
        ${appUrl ? `<a href="${escapeHtml(appUrl)}/account" style="color:#6b7280;text-decoration:none;">Manage subscription</a>
        &nbsp;&middot;&nbsp;` : ""}
        <a href="##UNSUBSCRIBE_URL##" style="color:#9ca3af;text-decoration:none;">Unsubscribe</a>
      </div>
    </div>

  </div>
</div>

</body>
</html>`.trim();
}
