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
import { renderBriefEmail, type BriefEmailData, type EmailBriefItem, type EmailBriefCategory } from "./briefEmailRenderer.js";

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
  content_json: Record<string, unknown>;
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
// Resend API call
// ---------------------------------------------------------------------------

async function sendViaResend(
  to: string,
  subject: string,
  html: string
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
      body: JSON.stringify({ from, to: [to], subject, html })
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
      recommended_actions: row.recommended_actions
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

  // 3. Fetch org name
  const orgResult = await pg.query<OrgRow>(
    `SELECT name FROM organizations WHERE id = $1`,
    [orgId]
  );
  const orgName = orgResult.rows[0]?.name ?? "Your Organisation";

  // 4. Fetch active subscribers with their delivery preferences
  const subscribersResult = await pg.query<SubscriberRow>(
    `SELECT id, email, name, min_severity, categories, notify_vendor_matches_only
     FROM intelligence_brief_subscribers
     WHERE organization_id = $1 AND active = TRUE
     ORDER BY subscribed_at ASC`,
    [orgId]
  );

  if (subscribersResult.rows.length === 0) {
    return { sent: 0, failed: 0, skipped: true, skipped_filtered: 0, message: "no_active_subscribers" };
  }

  const subject = buildSubject(brief.period_start, brief.period_end);
  const signalCount = parseInt(brief.signal_count, 10) || 0;
  const allItems = itemsResult.rows;

  // 5. Send to each subscriber with per-subscriber preference filtering
  let sent = 0;
  let failed = 0;
  let skippedFiltered = 0;

  for (const subscriber of subscribersResult.rows) {
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

    const emailData: BriefEmailData = {
      period_start: brief.period_start,
      period_end: brief.period_end,
      signal_count: signalCount,
      high_count,
      medium_count,
      low_count,
      categories
    };

    const unsubscribeUrl = buildUnsubscribeUrl(subscriber.id);
    const baseHtml = renderBriefEmail(emailData, orgName);
    const html = baseHtml.replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);

    const result = await sendViaResend(subscriber.email, subject, html);

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

  return { sent, failed, skipped: false, skipped_filtered: skippedFiltered };
}
