/**
 * briefEmailRenderer.ts — Pure HTML email renderer for Intelligence Briefs.
 *
 * No I/O. Pure function: accepts structured brief data and returns a complete
 * HTML email string. Fully unit-testable without any DB or network access.
 *
 * DESIGN CONSTRAINTS
 * ------------------
 * - Inline CSS only — no <style> tags, no external stylesheets, no external images.
 * - Table-based outer layout for maximum email client compatibility.
 * - All user-supplied content is HTML-escaped before insertion.
 * - Unsubscribe URL injected as literal {{unsubscribe_url}} placeholder;
 *   the sender replaces this with the real signed URL before delivery.
 *
 * LAYOUT
 * ------
 * Header (dark navy) → Summary bar → Category sections → Footer
 *
 * Each item:
 *   Title + severity badge + relevance badge
 *   CVE identifier (monospace, only if present)
 *   Summary paragraph
 *   WHY IT MATTERS block (amber left border) — omitted if null/empty
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
 * Return inline-CSS background and text colors for a severity level.
 *
 * Critical → red   (#ef4444 bg, white text)
 * High     → orange (#f97316 bg, white text)
 * Moderate → amber  (#d97706 bg, white text)
 * Low      → slate  (#94a3b8 bg, white text)
 */
function severityBadgeStyle(severity: string): string {
  const sev = severity.toLowerCase();
  let bg: string;
  if (sev === "critical") bg = "#ef4444";
  else if (sev === "high") bg = "#f97316";
  else if (sev === "moderate") bg = "#d97706";
  else bg = "#94a3b8";
  return `display:inline-block;background-color:${bg};color:#ffffff;font-size:10px;font-weight:700;` +
    `letter-spacing:0.06em;text-transform:uppercase;border-radius:3px;padding:2px 7px;`;
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
  return `display:inline-block;background-color:${bg};color:#ffffff;font-size:10px;font-weight:700;` +
    `letter-spacing:0.06em;text-transform:uppercase;border-radius:3px;padding:2px 7px;margin-left:5px;`;
}

/**
 * Convert a plain numbered list string (from Claude) into an HTML <ol>.
 * Input format: "1. Do this\n2. Do that\n3. And this"
 * Falls back to rendering as a single <p> if no numbered lines are detected.
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

  // Fallback: render as paragraphs
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

function renderHeader(data: BriefEmailData): string {
  const period = escHtml(formatPeriodLabel(data.period_start, data.period_end));
  return `
    <tr>
      <td style="background-color:#0f172a;padding:32px 40px;border-radius:8px 8px 0 0;">
        <div style="color:#f8fafc;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.01em;">
          SecureLogic AI
        </div>
        <div style="color:#94a3b8;font-size:12px;font-family:Arial,Helvetica,sans-serif;margin-top:2px;text-transform:uppercase;letter-spacing:0.08em;">
          Intelligence Brief
        </div>
        <div style="color:#e2e8f0;font-size:14px;font-family:Arial,Helvetica,sans-serif;margin-top:14px;font-weight:500;">
          ${period}
        </div>
        <div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;">
          <span style="background-color:#1e293b;color:#94a3b8;border-radius:4px;padding:4px 10px;font-size:11px;margin-right:8px;">
            ${escHtml(String(data.signal_count))} signals analyzed
          </span>
          <span style="background-color:#1e3a5f;color:#93c5fd;border-radius:4px;padding:4px 10px;font-size:11px;margin-right:8px;">
            ${escHtml(String(data.high_count))} high relevance
          </span>
          <span style="background-color:#1e293b;color:#94a3b8;border-radius:4px;padding:4px 10px;font-size:11px;margin-right:8px;">
            ${escHtml(String(data.medium_count))} medium
          </span>
          <span style="background-color:#1e293b;color:#94a3b8;border-radius:4px;padding:4px 10px;font-size:11px;">
            ${escHtml(String(data.low_count))} low
          </span>
        </div>
      </td>
    </tr>`.trim();
}

function renderItem(item: EmailBriefItem, isLast: boolean): string {
  const borderBottom = isLast ? "" : "border-bottom:1px solid #f1f5f9;";

  const cveBlock =
    item.affected_cve
      ? `<div style="font-family:'Courier New',Courier,monospace;font-size:11px;color:#64748b;margin-top:6px;letter-spacing:0.02em;">
           ${escHtml(item.affected_cve)}
         </div>`
      : "";

  const whyBlock =
    item.why_it_matters && item.why_it_matters.trim().length > 0
      ? `<div style="background-color:#fefce8;border-left:4px solid #eab308;padding:12px 16px;margin-top:14px;border-radius:0 4px 4px 0;">
           <div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;font-family:Arial,Helvetica,sans-serif;">
             Why It Matters
           </div>
           <div style="color:#78350f;font-size:13px;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">
             ${escHtml(item.why_it_matters.trim())}
           </div>
         </div>`
      : "";

  const actionsBlock =
    item.recommended_actions && item.recommended_actions.trim().length > 0
      ? `<div style="background-color:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;margin-top:10px;border-radius:0 4px 4px 0;">
           <div style="font-size:10px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px;font-family:Arial,Helvetica,sans-serif;">
             Recommended Actions
           </div>
           ${renderNumberedList(item.recommended_actions.trim())}
         </div>`
      : "";

  return `
    <tr>
      <td style="padding:20px 40px;${borderBottom}">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top;">
              <span style="font-size:15px;font-weight:700;color:#0f172a;font-family:Arial,Helvetica,sans-serif;line-height:1.4;">
                ${escHtml(item.title)}
              </span>
            </td>
            <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
              <span style="${severityBadgeStyle(item.severity)}">${escHtml(item.severity)}</span>
              <span style="${relevanceBadgeStyle(item.relevance)}">${escHtml(item.relevance)}</span>
            </td>
          </tr>
        </table>
        ${cveBlock}
        <div style="color:#374151;font-size:14px;line-height:1.65;margin-top:10px;font-family:Arial,Helvetica,sans-serif;">
          ${escHtml(item.summary)}
        </div>
        ${whyBlock}
        ${actionsBlock}
      </td>
    </tr>`.trim();
}

function renderCategory(group: EmailBriefCategory): string {
  if (group.items.length === 0) return "";

  const itemsHtml = group.items
    .map((item, idx) => renderItem(item, idx === group.items.length - 1))
    .join("\n");

  return `
    <tr>
      <td style="padding:28px 40px 0;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;font-family:Arial,Helvetica,sans-serif;
                    padding-bottom:10px;border-bottom:2px solid #e2e8f0;letter-spacing:-0.01em;">
          ${escHtml(group.label)}
        </div>
      </td>
    </tr>
    ${itemsHtml}`.trim();
}

function renderFooter(orgName: string): string {
  return `
    <tr>
      <td style="background-color:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;border-radius:0 0 8px 8px;">
        <div style="text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <div style="color:#64748b;font-size:12px;margin-bottom:8px;">
            <strong style="color:#0f172a;">${escHtml(orgName)}</strong> &mdash; SecureLogic AI Intelligence Brief
          </div>
          <div style="color:#94a3b8;font-size:11px;margin-bottom:10px;">
            You are receiving this because you subscribed to Intelligence Brief delivery.
          </div>
          <a href="{{unsubscribe_url}}"
             style="color:#6366f1;font-size:11px;text-decoration:underline;font-family:Arial,Helvetica,sans-serif;">
            Unsubscribe
          </a>
        </div>
      </td>
    </tr>`.trim();
}

// ---------------------------------------------------------------------------
// renderBriefEmail  (pure)
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
  const header = renderHeader(data);
  const footer = renderFooter(orgName);

  const categoryRows = data.categories
    .filter((g) => g.items.length > 0)
    .map((g) => renderCategory(g))
    .join("\n");

  const hasContent = data.categories.some((g) => g.items.length > 0);

  const noContentRow = hasContent
    ? ""
    : `<tr>
         <td style="padding:40px;text-align:center;color:#94a3b8;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
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
<body style="margin:0;padding:0;background-color:#f1f5f9;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#f1f5f9;min-width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background-color:#ffffff;
                      border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);
                      border:1px solid #e2e8f0;">
          ${header}
          ${categoryRows}
          ${noContentRow}
          ${footer}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
