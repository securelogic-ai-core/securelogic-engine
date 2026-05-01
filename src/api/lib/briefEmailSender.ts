/**
 * briefEmailSender.ts — Intelligence Brief email delivery via Resend.
 *
 * I/O-bound. Fetches brief and subscribers from DB, renders HTML via
 * briefEmailRenderer, sends via the Resend REST API, and records each
 * send attempt in intelligence_brief_sends.
 *
 * RESEND API
 * ----------
 * POST https://api.resend.com/emails
 * Authorization: Bearer {RESEND_API_KEY}
 *
 * FROM ADDRESS
 * ------------
 * Read from BRIEF_FROM_EMAIL env var. Falls back to "briefs@securelogic.ai".
 * This must be a verified sender domain in Resend.
 *
 * DELIVERY MODEL
 * --------------
 * One email per subscriber, sent sequentially. Failures are recorded in
 * intelligence_brief_sends with status='failed' but do not abort the batch.
 * The final summary counts sent, failed, and total subscribers.
 *
 * UNSUBSCRIBE URL
 * ---------------
 * The HTML template contains the literal placeholder {{unsubscribe_url}}.
 * This is replaced per-subscriber with a URL constructed from:
 *   BRIEF_UNSUBSCRIBE_BASE_URL env var + subscriber ID.
 * Falls back to "#" if the env var is not set (safe for development).
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { renderBriefEmail, renderBriefEmailText, type BriefEmailData, type EmailBriefItem, type EmailBriefCategory } from "./briefEmailRenderer.js";
import type { BriefSynthesis } from "./briefSynthesizer.js";

const RESEND_API_URL = "https://api.resend.com/emails";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

type BriefRow = {
  id: string;
  organization_id: string;
  period_start: string;
  period_end: string;
  status: string;
  signal_count: string;
  high_count: string;
  medium_count: string;
  low_count: string;
  // Intersection with Record<string, unknown> mirrors the frontend pattern
  // on IntelligenceBriefDetailResponse.content_json (app/src/lib/api.ts):
  // narrows the one field this module actually reads (synthesis) without
  // forcing a full mirror of the engine's BriefContentJson shape here.
  content_json: { synthesis?: BriefSynthesis | null } & Record<string, unknown>;
};

type BriefItemRow = {
  id: string;
  category: string;
  title: string;
  summary: string;
  severity: string;
  relevance: string;
  affected_cve: string | null;
  sort_order: string;
  why_it_matters: string | null;
  recommended_actions: string | null;
  is_personalized: boolean;
};

type SubscriberRow = {
  id: string;
  email: string;
  name: string | null;
  min_severity: string;
  categories: string[] | null;
  notify_vendor_matches_only: boolean;
};

type OrgRow = {
  name: string;
  plan: string | null;
};

// ---------------------------------------------------------------------------
// Subscriber preference filtering
// ---------------------------------------------------------------------------

/**
 * Severity rank map — higher number = higher severity.
 * Used to compare item severity against the subscriber's min_severity preference.
 */
export const SEVERITY_RANK: Record<string, number> = {
  Critical: 4,
  High: 3,
  Moderate: 2,
  Low: 1
};

/**
 * Filter brief items according to a subscriber's delivery preferences.
 *
 * Rules (applied in order, all must pass):
 *   1. min_severity — item severity must be >= subscriber's min_severity threshold.
 *   2. categories   — if set, item category must be in the allowlist.
 *   3. notify_vendor_matches_only — if true, item must be is_personalized = true.
 *
 * Pure function — no I/O. Exported for unit testing.
 */
export function filterItemsByPreferences(
  items: BriefItemRow[],
  prefs: {
    min_severity: string;
    categories: string[] | null;
    notify_vendor_matches_only: boolean;
  }
): BriefItemRow[] {
  const minRank = SEVERITY_RANK[prefs.min_severity] ?? 1;

  return items.filter((item) => {
    // 1. Severity threshold
    const itemRank = SEVERITY_RANK[item.severity] ?? 1;
    if (itemRank < minRank) return false;

    // 2. Category allowlist (null = all categories allowed)
    if (prefs.categories !== null && !prefs.categories.includes(item.category)) {
      return false;
    }

    // 3. Personalised-only filter
    if (prefs.notify_vendor_matches_only && !item.is_personalized) return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// Free-tier brief filter
// ---------------------------------------------------------------------------

/**
 * Returns a "Lite" version of the brief email data for free-tier subscribers.
 *
 * Transformations applied:
 *   - Keep only the top 3 items ranked by severity (Critical > High > Moderate > Low)
 *   - Truncate why_it_matters to 150 characters per item
 *   - Clear recommended_actions on all items (paid feature)
 *   - Set upgrade_cta = true so the renderer injects the upgrade banner
 *   - Preserve the original total signal count in total_signal_count
 *
 * Pure function — no I/O. Exported for unit testing.
 */
export function filterBriefForFreeTier(data: BriefEmailData): BriefEmailData {
  // Flatten all items across categories, preserving which category each belongs to
  type ScoredItem = { item: EmailBriefItem; cat: EmailBriefCategory; rank: number };
  const allItems: ScoredItem[] = [];

  for (const cat of data.categories) {
    for (const item of cat.items) {
      allItems.push({ item, cat, rank: SEVERITY_RANK[item.severity] ?? 1 });
    }
  }

  const totalSignalCount = allItems.length;

  // Sort descending by severity rank
  allItems.sort((a, b) => b.rank - a.rank);

  // Take top 3
  const top3 = allItems.slice(0, 3);
  const hiddenCount = Math.max(0, totalSignalCount - top3.length);

  // Apply per-item transformations
  const transform = (item: EmailBriefItem): EmailBriefItem => ({
    ...item,
    why_it_matters:
      item.why_it_matters && item.why_it_matters.length > 150
        ? item.why_it_matters.slice(0, 147) + "\u2026"
        : item.why_it_matters ?? null,
    recommended_actions: null,
  });

  // Rebuild category groups preserving original category order
  const catMap = new Map<string, EmailBriefItem[]>();
  for (const { item, cat } of top3) {
    if (!catMap.has(cat.category)) catMap.set(cat.category, []);
    catMap.get(cat.category)!.push(transform(item));
  }

  const newCategories: EmailBriefCategory[] = [];
  for (const cat of data.categories) {
    const items = catMap.get(cat.category);
    if (items && items.length > 0) {
      newCategories.push({ category: cat.category, label: cat.label, items });
    }
  }

  // Recompute relevance counts from the reduced item set
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  for (const { items } of newCategories) {
    for (const item of items) {
      const rel = item.relevance.toLowerCase();
      if (rel === "high") highCount++;
      else if (rel === "medium") mediumCount++;
      else lowCount++;
    }
  }

  return {
    ...data,
    categories: newCategories,
    signal_count: top3.length,
    high_count: highCount,
    medium_count: mediumCount,
    low_count: lowCount,
    upgrade_cta: true,
    total_signal_count: totalSignalCount,
    hidden_count: hiddenCount,
  };
}

// ---------------------------------------------------------------------------
// Resend API call
// ---------------------------------------------------------------------------

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const from =
    process.env["BRIEF_FROM_EMAIL"] ?? "SecureLogic AI <briefs@securelogic.ai>";

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to: [to], subject, html, text })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      return {
        ok: false,
        error: `Resend HTTP ${response.status}: ${body.slice(0, 200)}`
      };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Subject line
// ---------------------------------------------------------------------------

function buildSubject(periodStart: string, periodEnd: string): string {
  try {
    const start = new Date(periodStart).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    });
    const end = new Date(periodEnd).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
    return `Intelligence Brief: ${start} \u2013 ${end}`;
  } catch {
    return "SecureLogic AI — Intelligence Brief";
  }
}

// ---------------------------------------------------------------------------
// Unsubscribe URL
// ---------------------------------------------------------------------------

function buildUnsubscribeUrl(subscriberId: string): string {
  const base = process.env["BRIEF_UNSUBSCRIBE_BASE_URL"];
  if (!base) return "#";
  const url = base.endsWith("/") ? base : `${base}/`;
  return `${url}${subscriberId}`;
}

// ---------------------------------------------------------------------------
// Map content_json categories to BriefEmailData
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  vulnerability: "Vulnerabilities & Patches",
  threat_actor: "Threat Actors & Malware",
  vendor_incident: "Vendor & Supply Chain Incidents",
  general: "General Intelligence"
};

function mapCategoriesToEmailData(
  itemRows: BriefItemRow[],
  contentJson: Record<string, unknown>
): { categories: EmailBriefCategory[]; high_count: number; medium_count: number; low_count: number } {
  // Group items by category in canonical order
  const order = ["vulnerability", "threat_actor", "vendor_incident", "general"];
  const grouped = new Map<string, EmailBriefItem[]>();
  for (const cat of order) grouped.set(cat, []);

  for (const row of itemRows.sort((a, b) => parseInt(a.sort_order, 10) - parseInt(b.sort_order, 10))) {
    const cat = row.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push({
      title: row.title,
      summary: row.summary,
      severity: row.severity,
      relevance: row.relevance,
      affected_cve: row.affected_cve,
      why_it_matters: row.why_it_matters,
      recommended_actions: row.recommended_actions,
      is_personalized: row.is_personalized
    });
  }

  const categories: EmailBriefCategory[] = [];
  for (const cat of order) {
    const items = grouped.get(cat) ?? [];
    if (items.length > 0) {
      categories.push({
        category: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        items
      });
    }
  }

  // Derive counts from items (content_json counts may be stale)
  let high_count = 0;
  let medium_count = 0;
  let low_count = 0;
  for (const row of itemRows) {
    const rel = row.relevance.toLowerCase();
    if (rel === "high") high_count++;
    else if (rel === "medium") medium_count++;
    else low_count++;
  }

  return { categories, high_count, medium_count, low_count };
}

// ---------------------------------------------------------------------------
// sendBrief  (main entry point)
// ---------------------------------------------------------------------------

export type SendBriefResult = {
  sent: number;
  failed: number;
  /** True when there are no active subscribers at all. */
  skipped: boolean;
  /** Count of subscribers skipped because their preference filter removed all items. */
  skipped_filtered: number;
  /** Count of subscribers skipped because their email is in email_suppressions. */
  suppressed: number;
  message?: string;
};

/**
 * Deliver an Intelligence Brief to all active subscribers of the organisation.
 *
 * @param briefId  UUID of the intelligence_briefs row to send.
 * @param orgId    Organization ID — used to scope both the brief and subscribers.
 * @returns        Send summary: { sent, failed, skipped }
 *                 skipped = true when there are no active subscribers.
 */
export async function sendBrief(
  briefId: string,
  orgId: string
): Promise<SendBriefResult> {
  // 1. Fetch the brief row
  const briefResult = await pg.query<BriefRow>(
    `SELECT id, organization_id, period_start, period_end, status,
            signal_count,
            (content_json->>'high_count')::text AS high_count,
            (content_json->>'medium_count')::text AS medium_count,
            (content_json->>'low_count')::text AS low_count,
            content_json
     FROM intelligence_briefs
     WHERE id = $1 AND organization_id = $2`,
    [briefId, orgId]
  );

  if (briefResult.rows.length === 0) {
    throw new Error("brief_not_found");
  }

  const brief = briefResult.rows[0]!;

  if (brief.status !== "published") {
    throw new Error(`brief_not_published: status is '${brief.status}'`);
  }

  // 2. Fetch brief items (including is_personalized for preference filtering)
  const itemsResult = await pg.query<BriefItemRow>(
    `SELECT id, category, title, summary, severity, relevance, affected_cve,
            sort_order, why_it_matters, recommended_actions, is_personalized
     FROM intelligence_brief_items
     WHERE brief_id = $1 AND organization_id = $2
     ORDER BY sort_order ASC`,
    [briefId, orgId]
  );

  // 3. Fetch org name and plan
  const orgResult = await pg.query<OrgRow>(
    `SELECT name, plan FROM organizations WHERE id = $1`,
    [orgId]
  );
  const orgName = orgResult.rows[0]?.name ?? "Your Organisation";
  const orgPlan = orgResult.rows[0]?.plan ?? "free";
  const isFreeTier = orgPlan === "free" || orgPlan === "starter";

  // 4. Fetch active subscribers with their delivery preferences
  const subscribersResult = await pg.query<SubscriberRow>(
    `SELECT id, email, name, min_severity, categories, notify_vendor_matches_only
     FROM intelligence_brief_subscribers
     WHERE organization_id = $1 AND active = TRUE
     ORDER BY subscribed_at ASC`,
    [orgId]
  );

  if (subscribersResult.rows.length === 0) {
    return { sent: 0, failed: 0, skipped: true, skipped_filtered: 0, suppressed: 0, message: "no_active_subscribers" };
  }

  const subject = buildSubject(brief.period_start, brief.period_end);
  const signalCount = parseInt(brief.signal_count, 10) || 0;
  const allItems = itemsResult.rows;

  // Brief-level synthesis lives at content_json.synthesis. Read once here
  // and pass into every per-subscriber emailData literal below; the
  // renderer's executive_headline / executive_summary fields are already
  // null-safe so legacy briefs without synthesis render unchanged.
  const synthesis = brief.content_json?.synthesis ?? null;
  const executiveHeadline = synthesis?.headline ?? null;
  const executiveSummary = synthesis?.exec_summary ?? null;

  // 5. Batch-check which subscriber emails are suppressed before sending.
  const subscriberEmails = subscribersResult.rows.map(s => s.email.toLowerCase());
  const suppressedResult = await pg.query<{ email: string }>(
    `SELECT LOWER(email) AS email FROM email_suppressions
     WHERE LOWER(email) = ANY($1::text[])`,
    [subscriberEmails]
  );
  const suppressedEmails = new Set(suppressedResult.rows.map(r => r.email));

  // 6. Send to each subscriber with per-subscriber preference filtering
  let sent = 0;
  let failed = 0;
  let skippedFiltered = 0;
  let suppressed = 0;

  for (const subscriber of subscribersResult.rows) {
    // Skip suppressed addresses and record the outcome.
    if (suppressedEmails.has(subscriber.email.toLowerCase())) {
      suppressed++;
      logger.warn(
        {
          event: "brief_send_suppressed",
          briefId,
          subscriberId: subscriber.id,
          email: subscriber.email,
          orgId
        },
        "Brief send skipped — subscriber email is suppressed"
      );
      await pg.query(
        `INSERT INTO intelligence_brief_sends (brief_id, subscriber_id, status, error_message)
         VALUES ($1, $2, 'suppressed', 'email_suppressed')`,
        [briefId, subscriber.id]
      ).catch((err) => {
        logger.warn(
          { event: "brief_send_audit_failed", briefId, subscriberId: subscriber.id, err },
          "Failed to record suppressed audit row"
        );
      });
      continue;
    }

    // Apply subscriber delivery preferences — filter items before rendering.
    const filteredItems = filterItemsByPreferences(allItems, {
      min_severity: subscriber.min_severity,
      categories: subscriber.categories,
      notify_vendor_matches_only: subscriber.notify_vendor_matches_only
    });

    // If all items are filtered out, skip delivery for this subscriber.
    // We still record a skipped-style outcome in the log but do not fail the batch.
    if (filteredItems.length === 0) {
      skippedFiltered++;
      logger.info(
        {
          event: "brief_send_filtered_empty",
          briefId,
          subscriberId: subscriber.id,
          email: subscriber.email,
          min_severity: subscriber.min_severity,
          notify_vendor_matches_only: subscriber.notify_vendor_matches_only
        },
        "Brief send skipped — all items filtered by subscriber preferences"
      );
      continue;
    }

    // Build per-subscriber email data from filtered items.
    const { categories, high_count, medium_count, low_count } = mapCategoriesToEmailData(
      filteredItems,
      brief.content_json
    );

    let emailData: BriefEmailData = {
      period_start: brief.period_start,
      period_end: brief.period_end,
      signal_count: signalCount,
      high_count,
      medium_count,
      low_count,
      categories,
      executive_headline: executiveHeadline,
      executive_summary: executiveSummary
    };

    // For free-tier organisations, send the Brief Lite version:
    // top 3 signals only, truncated why_it_matters, no recommended_actions,
    // and an upgrade CTA banner in the email.
    if (isFreeTier) {
      emailData = filterBriefForFreeTier(emailData);
    }

    const unsubscribeUrl = buildUnsubscribeUrl(subscriber.id);
    const baseHtml = renderBriefEmail(emailData, orgName);
    const html = baseHtml.replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);
    const baseText = renderBriefEmailText(emailData, orgName);
    const text = baseText.replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);

    const result = await sendViaResend(subscriber.email, subject, html, text);

    if (result.ok) {
      sent++;
      await pg.query(
        `INSERT INTO intelligence_brief_sends (brief_id, subscriber_id, status)
         VALUES ($1, $2, 'sent')`,
        [briefId, subscriber.id]
      ).catch((err) => {
        logger.warn(
          { event: "brief_send_audit_failed", briefId, subscriberId: subscriber.id, err },
          "Failed to record send audit row"
        );
      });

      logger.info(
        { event: "brief_sent", briefId, subscriberId: subscriber.id, email: subscriber.email },
        "Intelligence Brief sent"
      );
    } else {
      failed++;
      await pg.query(
        `INSERT INTO intelligence_brief_sends (brief_id, subscriber_id, status, error_message)
         VALUES ($1, $2, 'failed', $3)`,
        [briefId, subscriber.id, result.error ?? "unknown_error"]
      ).catch((err) => {
        logger.warn(
          { event: "brief_send_audit_failed", briefId, subscriberId: subscriber.id, err },
          "Failed to record send audit row"
        );
      });

      logger.error(
        {
          event: "brief_send_failed",
          briefId,
          subscriberId: subscriber.id,
          email: subscriber.email,
          error: result.error
        },
        "Intelligence Brief send failed"
      );
    }
  }

  return { sent, failed, skipped: false, skipped_filtered: skippedFiltered, suppressed };
}
