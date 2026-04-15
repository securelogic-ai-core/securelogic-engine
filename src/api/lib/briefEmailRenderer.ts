/**
 * briefEmailRenderer.ts — Pure HTML email renderer for Intelligence Briefs.
 *
 * No I/O. Pure function: accepts structured brief data and returns a complete
 * HTML email string. Fully unit-testable without any DB or network access.
 *
 * DESIGN CONSTRAINTS (v2)
 * -----------------------
 * - Inline CSS only — no <style> tags, no external stylesheets.
 * - Table-based layout everywhere — Outlook does not support flexbox.
 * - bgcolor attributes on every background-color table cell (Outlook fallback).
 * - Logo rendered as <img> tag — SVG is stripped by many mail clients.
 * - All user-supplied content is HTML-escaped before insertion.
 * - Unsubscribe URL injected as literal {{unsubscribe_url}} placeholder;
 *   the sender replaces this with the real signed URL before delivery.
 *
 * LAYOUT
 * ------
 * Masthead (dark navy, logo + date pill) →
 * Hero (period label, optional headline, risk count pills) →
 * Executive Summary (optional) →
 * Category sections (section header + item cards) →
 * Cycle Summary (counts bar) →
 * Footer (logo + links)
 *
 * Each item card:
 *   Title + severity badge + relevance badge + category badge
 *   [Personalized badge — Brief Pro subscribers only]
 *   CVE identifier (monospace, only if present)
 *   Summary paragraph
 *   WHY IT MATTERS block (amber left border) — omitted if null/empty
 *   AUDIENCE tags — omitted if null/empty
 *   RECOMMENDED ACTIONS block (green left border) — omitted if null/empty
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailBriefItem = {
  title: string;
  summary: string;
  severity: string;
  relevance: string;
  affected_cve: string | null;
  why_it_matters?: string | null;
  recommended_actions?: string | null;
  /** v2 — audience role tags (e.g. ["Security Operations", "Risk Teams"]) */
  audience?: string[] | null;
  /** v2 — shows a "Personalized" badge for Brief Pro subscribers */
  is_personalized?: boolean;
};

export type EmailBriefCategory = {
  category: string;
  label: string;
  items: EmailBriefItem[];
};

export type BriefEmailData = {
  period_start: string;
  period_end: string;
  signal_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  categories: EmailBriefCategory[];
  /** v2 — short punchy headline shown in the hero, e.g. "High-threat week." */
  executive_headline?: string | null;
  /** v2 — full executive summary paragraph shown beneath the hero */
  executive_summary?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a string for safe insertion into HTML text nodes and attribute values. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format an ISO timestamp as a human-readable date string.
 * e.g. "2026-04-07T00:00:00.000Z" → "April 7, 2026"
 */
function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC"
    });
  } catch {
    return isoString;
  }
}

/**
 * Build the "Week of April 7 – April 14, 2026" period label.
 */
function formatPeriodLabel(periodStart: string, periodEnd: string): string {
  try {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const startStr = start.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC"
    });
    const endStr = end.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
    return `Week of ${startStr} \u2013 ${endStr}`;
  } catch {
    return `${periodStart} \u2013 ${periodEnd}`;
  }
}

/**
 * Return inline-CSS background and text colors for a severity badge.
 *
 * Critical → red   (#ef4444)
 * High     → orange (#f97316)
 * Moderate → amber  (#d97706)
 * Low      → slate  (#94a3b8)
 */
function severityBadgeStyle(severity: string): string {
  const sev = severity.toLowerCase();
  let bg: string;
  if (sev === "critical") bg = "#ef4444";
  else if (sev === "high") bg = "#f97316";
  else if (sev === "moderate") bg = "#d97706";
  else bg = "#94a3b8";
  return (
    `display:inline-block;background-color:${bg};color:#ffffff;font-size:10px;font-weight:700;` +
    `letter-spacing:0.06em;text-transform:uppercase;border-radius:3px;padding:2px 7px;`
  );
}

/**
 * Return inline-CSS for a relevance badge.
 *
 * high   → indigo (#6366f1)
 * medium → sky    (#0ea5e9)
 * low    → slate  (#64748b)
 */
function relevanceBadgeStyle(relevance: string): string {
  const rel = relevance.toLowerCase();
  let bg: string;
  if (rel === "high") bg = "#6366f1";
  else if (rel === "medium") bg = "#0ea5e9";
  else bg = "#64748b";
  return (
    `display:inline-block;background-color:${bg};color:#ffffff;font-size:10px;font-weight:700;` +
    `letter-spacing:0.06em;text-transform:uppercase;border-radius:3px;padding:2px 7px;margin-left:5px;`
  );
}

/**
 * Convert a plain numbered list string (from Claude) into an HTML <ol>.
 * Input: "1. Do this\n2. Do that"
 * Falls back to <p> paragraphs if no numbered lines detected.
 */
function renderNumberedList(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const numbered = lines.filter((l) => /^\d+[\.\)]\s/.test(l));

  if (numbered.length >= 2) {
    const listItems = numbered
      .map((l) => {
        const content = escHtml(l.replace(/^\d+[\.\)]\s+/, ""));
        return `<li style="margin-bottom:6px;color:#166534;font-size:13px;line-height:1.6;">${content}</li>`;
      })
      .join("\n");
    return `<ol style="margin:0;padding-left:20px;">\n${listItems}\n</ol>`;
  }

  return lines
    .map(
      (l) =>
        `<p style="margin:0 0 6px 0;color:#166534;font-size:13px;line-height:1.6;">${escHtml(l)}</p>`
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

/**
 * Masthead + hero row.
 *
 * Dark navy background (#0f172a). Contains:
 * - Logo <img> + date pill (table row, no flexbox)
 * - Period label
 * - Optional executive headline
 * - Risk count pills (table row, no flexbox)
 */
function renderMasthead(data: BriefEmailData): string {
  const period = escHtml(formatPeriodLabel(data.period_start, data.period_end));
  const dateLabel = escHtml(formatDate(data.period_end));

  const headlineHtml =
    data.executive_headline?.trim()
      ? `<div style="color:#f1f5f9;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;
                    line-height:1.3;margin-bottom:8px;letter-spacing:-0.02em;">
           ${escHtml(data.executive_headline.trim())}
         </div>`
      : "";

  return `
    <tr>
      <td bgcolor="#0f172a"
          style="background-color:#0f172a;padding:28px 40px 32px;border-radius:8px 8px 0 0;">

        <!-- Logo + date pill — table layout (Outlook has no flexbox) -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <img src="https://api.securelogicai.com/assets/logo.png"
                   alt="SecureLogic AI" height="36"
                   style="display:block;">
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <span style="background-color:#1e293b;color:#94a3b8;border-radius:4px;
                           padding:4px 10px;font-size:11px;font-family:Arial,Helvetica,sans-serif;
                           letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;">
                Intelligence Brief &middot; ${dateLabel}
              </span>
            </td>
          </tr>
        </table>

        <!-- Period label -->
        <div style="color:#64748b;font-size:11px;font-family:Arial,Helvetica,sans-serif;
                    text-transform:uppercase;letter-spacing:0.08em;margin-top:24px;margin-bottom:14px;">
          ${period}
        </div>

        <!-- Optional executive headline -->
        ${headlineHtml}

        <!-- Risk count + signal total pills — table layout (Outlook has no flexbox) -->
        <table cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
          <tr>
            <td style="padding-right:8px;">
              <span style="display:inline-block;background-color:#7f1d1d;color:#fca5a5;
                           border-radius:4px;padding:4px 12px;font-size:12px;font-weight:700;
                           font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
                ${escHtml(String(data.high_count))} High Risk
              </span>
            </td>
            <td style="padding-right:8px;">
              <span style="display:inline-block;background-color:#78350f;color:#fcd34d;
                           border-radius:4px;padding:4px 12px;font-size:12px;font-weight:700;
                           font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
                ${escHtml(String(data.medium_count))} Medium Risk
              </span>
            </td>
            <td style="padding-right:8px;">
              <span style="display:inline-block;background-color:#1e293b;color:#94a3b8;
                           border-radius:4px;padding:4px 12px;font-size:12px;font-weight:700;
                           font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
                ${escHtml(String(data.low_count))} Low Risk
              </span>
            </td>
            <td>
              <span style="display:inline-block;background-color:#1e293b;color:#64748b;
                           border-radius:4px;padding:4px 12px;font-size:12px;font-weight:700;
                           font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
                ${escHtml(String(data.signal_count))} signals analyzed
              </span>
            </td>
          </tr>
        </table>

      </td>
    </tr>`.trim();
}

/** Optional executive summary block — omitted entirely when not set. */
function renderExecutiveSummary(data: BriefEmailData): string {
  if (!data.executive_summary?.trim()) return "";

  return `
    <tr>
      <td bgcolor="#f8fafc"
          style="background-color:#f8fafc;padding:24px 40px;border-bottom:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;
                    letter-spacing:0.1em;margin-bottom:10px;font-family:Arial,Helvetica,sans-serif;">
          Executive Summary
        </div>
        <div style="color:#374151;font-size:14px;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">
          ${escHtml(data.executive_summary.trim())}
        </div>
      </td>
    </tr>`.trim();
}

/** Single intelligence item card. */
function renderItem(item: EmailBriefItem, isLast: boolean, categoryKey: string): string {
  const borderBottom = isLast ? "" : "border-bottom:1px solid #f1f5f9;";

  // Category badge — raw key uppercased (e.g. VULNERABILITY, THREAT_ACTOR)
  const catLabel = escHtml(categoryKey.replace(/_/g, " ").toUpperCase());
  const categoryBadge =
    `<span style="display:inline-block;background-color:#1e293b;color:#94a3b8;font-size:10px;` +
    `font-weight:700;letter-spacing:0.06em;text-transform:uppercase;border-radius:3px;` +
    `padding:2px 7px;margin-left:5px;">${catLabel}</span>`;

  // Brief Pro personalisation badge
  const personalizedBadge = item.is_personalized
    ? `<span style="display:inline-block;background-color:#ede9fe;color:#5b21b6;font-size:10px;` +
      `font-weight:700;letter-spacing:0.06em;text-transform:uppercase;border-radius:3px;` +
      `padding:2px 7px;margin-left:5px;">Personalized</span>`
    : "";

  const cveBlock = item.affected_cve
    ? `<div style="font-family:'Courier New',Courier,monospace;font-size:11px;color:#64748b;` +
      `margin-top:6px;letter-spacing:0.02em;">${escHtml(item.affected_cve)}</div>`
    : "";

  const whyBlock =
    item.why_it_matters && item.why_it_matters.trim().length > 0
      ? `<div style="background-color:#fefce8;border-left:4px solid #eab308;padding:12px 16px;` +
        `margin-top:14px;border-radius:0 4px 4px 0;">
           <div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;` +
               `letter-spacing:0.07em;margin-bottom:6px;font-family:Arial,Helvetica,sans-serif;">
             Why It Matters
           </div>
           <div style="color:#78350f;font-size:13px;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
             ${escHtml(item.why_it_matters.trim())}
           </div>
         </div>`
      : "";

  const audienceBlock =
    item.audience && item.audience.length > 0
      ? `<div style="margin-top:12px;">
           <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;` +
               `letter-spacing:0.07em;margin-bottom:6px;font-family:Arial,Helvetica,sans-serif;">
             Audience
           </div>
           <div>${item.audience
             .map(
               (a) =>
                 `<span style="display:inline-block;background-color:#f1f5f9;color:#374151;` +
                 `border-radius:3px;padding:2px 8px;font-size:11px;font-family:Arial,Helvetica,sans-serif;` +
                 `margin:2px 4px 2px 0;">${escHtml(a)}</span>`
             )
             .join("")}</div>
         </div>`
      : "";

  const actionsBlock =
    item.recommended_actions && item.recommended_actions.trim().length > 0
      ? `<div style="background-color:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;` +
        `margin-top:10px;border-radius:0 4px 4px 0;">
           <div style="font-size:10px;font-weight:700;color:#14532d;text-transform:uppercase;` +
               `letter-spacing:0.07em;margin-bottom:8px;font-family:Arial,Helvetica,sans-serif;">
             Recommended Actions
           </div>
           ${renderNumberedList(item.recommended_actions.trim())}
         </div>`
      : "";

  return `
    <tr>
      <td style="padding:20px 40px;${borderBottom}background-color:#ffffff;">
        <!-- Title + badges — table layout (Outlook has no flexbox) -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:top;">
              <span style="font-size:15px;font-weight:700;color:#0f172a;
                           font-family:Arial,Helvetica,sans-serif;line-height:1.4;">
                ${escHtml(item.title)}
              </span>
              ${personalizedBadge}
            </td>
            <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
              <span style="${severityBadgeStyle(item.severity)}">${escHtml(item.severity)}</span>
              <span style="${relevanceBadgeStyle(item.relevance)}">${escHtml(item.relevance)}</span>
              ${categoryBadge}
            </td>
          </tr>
        </table>
        ${cveBlock}
        <div style="color:#374151;font-size:14px;line-height:1.65;margin-top:10px;
                    font-family:Arial,Helvetica,sans-serif;">
          ${escHtml(item.summary)}
        </div>
        ${whyBlock}
        ${audienceBlock}
        ${actionsBlock}
      </td>
    </tr>`.trim();
}

/** Category section: header row + item cards. Skipped entirely if no items. */
function renderCategory(group: EmailBriefCategory): string {
  if (group.items.length === 0) return "";

  const signalLabel =
    group.items.length === 1 ? "1 Signal" : `${group.items.length} Signals`;

  const sectionHeader = `
    <tr>
      <td bgcolor="#f8fafc"
          style="background-color:#f8fafc;padding:14px 40px;
                 border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
        <!-- Section label + signal count — table layout (Outlook has no flexbox) -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;">
              <span style="font-size:13px;font-weight:700;color:#0f172a;
                           font-family:Arial,Helvetica,sans-serif;
                           letter-spacing:0.04em;text-transform:uppercase;">
                ${escHtml(group.label)}
              </span>
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <span style="background-color:#e2e8f0;color:#64748b;border-radius:3px;
                           padding:3px 8px;font-size:11px;font-weight:600;
                           font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
                ${escHtml(signalLabel)}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`.trim();

  const itemsHtml = group.items
    .map((item, idx) => renderItem(item, idx === group.items.length - 1, group.category))
    .join("\n");

  return `${sectionHeader}\n${itemsHtml}`;
}

/** Dark cycle-summary bar: High / Medium / Low / Total counts. */
function renderCycleSummary(data: BriefEmailData): string {
  const dateLabel = escHtml(formatDate(data.period_end));
  const total = data.high_count + data.medium_count + data.low_count;

  return `
    <tr>
      <td bgcolor="#0f172a"
          style="background-color:#0f172a;padding:28px 40px;border-top:1px solid #1e293b;">
        <div style="color:#64748b;font-size:10px;font-family:Arial,Helvetica,sans-serif;
                    text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;">
          Cycle Summary &middot; ${dateLabel}
        </div>
        <!-- Stats — table layout (Outlook has no flexbox) -->
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:28px;text-align:center;">
              <div style="color:#f87171;font-size:28px;font-weight:700;
                          font-family:Arial,Helvetica,sans-serif;line-height:1;">
                ${escHtml(String(data.high_count))}
              </div>
              <div style="color:#64748b;font-size:10px;font-family:Arial,Helvetica,sans-serif;
                          text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">
                High
              </div>
            </td>
            <td style="padding-right:28px;text-align:center;">
              <div style="color:#fcd34d;font-size:28px;font-weight:700;
                          font-family:Arial,Helvetica,sans-serif;line-height:1;">
                ${escHtml(String(data.medium_count))}
              </div>
              <div style="color:#64748b;font-size:10px;font-family:Arial,Helvetica,sans-serif;
                          text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">
                Medium
              </div>
            </td>
            <td style="padding-right:28px;text-align:center;">
              <div style="color:#94a3b8;font-size:28px;font-weight:700;
                          font-family:Arial,Helvetica,sans-serif;line-height:1;">
                ${escHtml(String(data.low_count))}
              </div>
              <div style="color:#64748b;font-size:10px;font-family:Arial,Helvetica,sans-serif;
                          text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">
                Low
              </div>
            </td>
            <td style="padding-left:28px;border-left:1px solid #1e293b;text-align:center;">
              <div style="color:#e2e8f0;font-size:28px;font-weight:700;
                          font-family:Arial,Helvetica,sans-serif;line-height:1;">
                ${escHtml(String(total))}
              </div>
              <div style="color:#64748b;font-size:10px;font-family:Arial,Helvetica,sans-serif;
                          text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">
                Total
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`.trim();
}

/** Dark footer: logo, subscriber note, unsubscribe link, org name. */
function renderFooter(orgName: string): string {
  return `
    <tr>
      <td bgcolor="#0f172a"
          style="background-color:#0f172a;padding:24px 40px;
                 border-radius:0 0 8px 8px;border-top:1px solid #1e293b;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-bottom:16px;">
              <img src="https://api.securelogicai.com/assets/logo.png"
                   alt="SecureLogic AI" height="24"
                   style="display:block;">
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:12px;">
              <div style="color:#64748b;font-size:12px;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
                You are receiving this brief as a subscriber to
                <strong style="color:#94a3b8;">SecureLogic AI Intelligence</strong>.
                This brief is generated weekly from live threat intelligence sources
                including CISA KEV, NVD, CISA Alerts, and regulatory feeds.
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:16px;">
              <a href="{{unsubscribe_url}}"
                 style="color:#6366f1;font-size:11px;text-decoration:underline;
                        font-family:Arial,Helvetica,sans-serif;">
                Unsubscribe
              </a>
              <span style="color:#334155;font-size:11px;font-family:Arial,Helvetica,sans-serif;
                           margin:0 8px;">&nbsp;&middot;&nbsp;</span>
              <span style="color:#475569;font-size:11px;font-family:Arial,Helvetica,sans-serif;">
                Manage preferences
              </span>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #1e293b;padding-top:16px;">
              <div style="color:#334155;font-size:11px;font-family:Arial,Helvetica,sans-serif;">
                ${escHtml(orgName)} &mdash; SecureLogic AI Intelligence Brief
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`.trim();
}

// ---------------------------------------------------------------------------
// renderBriefEmailText  (plain-text fallback)
// ---------------------------------------------------------------------------

/**
 * Render a plain-text version of an Intelligence Brief for use as the
 * multipart/alternative text part alongside the HTML email.
 *
 * Required by CAN-SPAM and improves deliverability when HTML is stripped.
 * Contains the literal placeholder {{unsubscribe_url}} — the caller must
 * replace this before sending, same as the HTML version.
 */
export function renderBriefEmailText(data: BriefEmailData, orgName: string): string {
  const DIVIDER = "─".repeat(60);
  const period = formatPeriodLabel(data.period_start, data.period_end);

  const lines: string[] = [
    "SECURELOGIC AI — INTELLIGENCE BRIEF",
    period,
    "",
    `${data.signal_count} signals analyzed  |  ${data.high_count} high  |  ` +
      `${data.medium_count} medium  |  ${data.low_count} low`,
    "",
  ];

  if (data.executive_headline?.trim()) {
    lines.push(data.executive_headline.trim(), "");
  }

  if (data.executive_summary?.trim()) {
    lines.push("EXECUTIVE SUMMARY", data.executive_summary.trim(), "");
  }

  const populated = data.categories.filter((g) => g.items.length > 0);

  if (populated.length === 0) {
    lines.push("No intelligence items for this period.", "");
  } else {
    for (const group of populated) {
      lines.push(DIVIDER, `${group.label.toUpperCase()} (${group.items.length} signals)`, DIVIDER, "");

      for (const item of group.items) {
        const badges = `[${item.severity.toUpperCase()} | ${item.relevance.toUpperCase()} RELEVANCE]`;
        lines.push(`${item.title}  ${badges}`);

        if (item.affected_cve) {
          lines.push(item.affected_cve);
        }
        lines.push("", item.summary);

        if (item.why_it_matters?.trim()) {
          lines.push("", "WHY IT MATTERS", item.why_it_matters.trim());
        }

        if (item.audience && item.audience.length > 0) {
          lines.push("", "AUDIENCE", item.audience.join(" | "));
        }

        if (item.recommended_actions?.trim()) {
          lines.push("", "RECOMMENDED ACTIONS", item.recommended_actions.trim());
        }

        lines.push("");
      }
    }
  }

  lines.push(
    DIVIDER,
    `${orgName} — SecureLogic AI Intelligence Brief`,
    "You are receiving this because you subscribed to Intelligence Brief delivery.",
    "",
    "To unsubscribe: {{unsubscribe_url}}",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// renderBriefEmail  (pure, main entry point)
// ---------------------------------------------------------------------------

/**
 * Render a complete HTML email string for an Intelligence Brief.
 *
 * Pure function — no I/O. Safe to call in tests without any mocking.
 *
 * @param data     Structured brief data (from DB, mapped to BriefEmailData shape).
 * @param orgName  Organization name to display in header and footer.
 * @returns        Complete HTML string, ready for delivery.
 *                 Contains the literal placeholder {{unsubscribe_url}} in the
 *                 footer — the caller must replace this before sending.
 */
export function renderBriefEmail(data: BriefEmailData, orgName: string): string {
  const masthead = renderMasthead(data);
  const executiveSummary = renderExecutiveSummary(data);
  const cycleSummary = renderCycleSummary(data);
  const footer = renderFooter(orgName);

  const categoryRows = data.categories
    .filter((g) => g.items.length > 0)
    .map((g) => renderCategory(g))
    .join("\n");

  const hasContent = data.categories.some((g) => g.items.length > 0);

  const noContentRow = hasContent
    ? ""
    : `<tr>
         <td style="padding:40px;text-align:center;color:#94a3b8;
                    font-family:Arial,Helvetica,sans-serif;font-size:14px;background-color:#ffffff;">
           No intelligence items for this period.
         </td>
       </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SecureLogic AI — Intelligence Brief</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0f1a;-webkit-font-smoothing:antialiased;">
  <!-- bgcolor is the Outlook fallback for CSS background-color on tables -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         bgcolor="#0a0f1a"
         style="background-color:#0a0f1a;min-width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="640" cellpadding="0" cellspacing="0" border="0"
               bgcolor="#ffffff"
               style="max-width:640px;width:100%;background-color:#ffffff;border-radius:8px;">
          ${masthead}
          ${executiveSummary}
          ${categoryRows}
          ${noContentRow}
          ${cycleSummary}
          ${footer}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
