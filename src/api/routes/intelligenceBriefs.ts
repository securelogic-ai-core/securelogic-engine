/**
 * intelligenceBriefs.ts — Intelligence Brief pipeline API
 *
 * The Intelligence Brief is a weekly curated summary of the external cyber
 * threat landscape. It is generated from the org's ingested cyber_signals
 * and is entirely separate from the internal posture and findings system.
 *
 * GENERATION PIPELINE
 * -------------------
 *  1. Validate period window (default: last 7 days).
 *  2. Pull all cyber_signals for the org in the window.
 *  3. Set brief status to 'generating', create brief row.
 *  4. Run generateBrief() pure function (intelligenceBriefGenerator).
 *  5. Insert brief items.
 *  6. Update brief row: status='published', content_json, content_markdown, counts.
 *
 * Routes:
 *   POST  /api/intelligence-briefs/generate  — generate a new brief for the org
 *   GET   /api/intelligence-briefs           — list briefs (cursor paginated)
 *   GET   /api/intelligence-briefs/:id       — get brief with items
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  generateBrief,
  enrichBriefItems,
  type CyberSignalForBrief,
  type BriefItem
} from "../lib/intelligenceBriefGenerator.js";
import { personalizeBriefItems } from "../lib/briefPersonalizationService.js";
import { sendBrief } from "../lib/briefEmailSender.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { encryptField, decryptField } from "../lib/fieldEncryption.js";

/**
 * Decrypt and parse content_json from the DB.
 * Handles encrypted rows (JSON-string value) and legacy plaintext JSONB objects.
 */
function parseContentJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(decryptField(value)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

const router = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ISO 8601 date-only (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:MM...) pattern.
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function parseIsoDate(raw: string): Date | null {
  if (!ISO_8601_RE.test(raw)) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Middleware — all routes require API key + org context.
// Read routes (GET list, GET detail) are reachable on starter tier so free
// orgs see the briefs the platform produces for them. Mutating routes
// (generate, send, subscribers, preferences) keep requireEntitlement("standard")
// inline below — paid tier only.
// ---------------------------------------------------------------------------

router.use(
  "/intelligence-briefs",
  requireApiKey,
  attachOrganizationContext
);

// ---------------------------------------------------------------------------
// POST /api/intelligence-briefs/generate
// ---------------------------------------------------------------------------

router.post("/intelligence-briefs/generate", requireEntitlement("standard"), async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;

  // Accept optional period_start / period_end; default to last 7 days.
  // Both must be valid ISO 8601 strings. Window may not exceed 30 days.
  const rawStart = req.body?.period_start as unknown;
  const rawEnd = req.body?.period_end as unknown;

  let periodEnd: Date;
  let periodStart: Date;

  if (rawEnd !== undefined) {
    if (typeof rawEnd !== "string") {
      return res.status(400).json({ error: "invalid_period_end", message: "period_end must be an ISO 8601 string" });
    }
    const parsed = parseIsoDate(rawEnd);
    if (!parsed) {
      return res.status(400).json({ error: "invalid_period_end", message: "period_end must be a valid ISO 8601 date" });
    }
    periodEnd = parsed;
  } else {
    periodEnd = new Date();
  }

  if (rawStart !== undefined) {
    if (typeof rawStart !== "string") {
      return res.status(400).json({ error: "invalid_period_start", message: "period_start must be an ISO 8601 string" });
    }
    const parsed = parseIsoDate(rawStart);
    if (!parsed) {
      return res.status(400).json({ error: "invalid_period_start", message: "period_start must be a valid ISO 8601 date" });
    }
    periodStart = parsed;
  } else {
    periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  if (periodStart >= periodEnd) {
    return res.status(400).json({ error: "period_start_must_be_before_period_end" });
  }

  if (periodEnd.getTime() - periodStart.getTime() > MAX_WINDOW_MS) {
    return res.status(400).json({
      error: "period_window_too_large",
      message: "Window between period_start and period_end cannot exceed 30 days"
    });
  }

  const client = await pg.connect();

  try {
    await client.query("BEGIN");

    // Create brief row in 'generating' state
    const insertBriefResult = await client.query<{ id: string }>(
      `INSERT INTO intelligence_briefs
         (organization_id, period_start, period_end, status)
       VALUES ($1, $2, $3, 'generating')
       RETURNING id`,
      [orgId, periodStart.toISOString(), periodEnd.toISOString()]
    );

    const briefId = insertBriefResult.rows[0]!.id;

    // Pull cyber signals in the window — include global signals (organization_id IS NULL)
    // because the pipeline bridges all ingested signals as global (no org scope).
    const signalsResult = await client.query<CyberSignalForBrief>(
      `SELECT
         id,
         signal_type,
         severity,
         normalized_summary,
         affected_cve,
         affected_vendor,
         source,
         ingestion_timestamp
       FROM cyber_signals
       WHERE (organization_id = $1 OR organization_id IS NULL)
         AND ingestion_timestamp >= $2
         AND ingestion_timestamp < $3
       ORDER BY ingestion_timestamp DESC`,
      [orgId, periodStart.toISOString(), periodEnd.toISOString()]
    );

    const signals = signalsResult.rows;

    // Run pure generation then async Claude enrichment
    const base = generateBrief(signals, periodStart.toISOString(), periodEnd.toISOString());

    // Enrich items with Claude analyst commentary (non-fatal — always resolves)
    const enrichedItems = await enrichBriefItems(base.items);

    // Personalize items — match against org's vendors, risks, AI systems, obligations.
    // Non-fatal: if personalization fails the brief still publishes without personalization.
    let personalizedItems: Awaited<ReturnType<typeof personalizeBriefItems>>;
    try {
      personalizedItems = await personalizeBriefItems(enrichedItems, orgId);
    } catch (personalizationErr) {
      logger.warn(
        { event: "brief_personalization_failed", orgId, briefId, err: personalizationErr },
        "Brief personalization failed — publishing without personalization data"
      );
      personalizedItems = enrichedItems.map((item) => ({
        ...item,
        is_personalized: false,
        platform_context: null
      }));
    }

    // Insert brief items (18 columns per item including personalization fields)
    if (personalizedItems.length > 0) {
      const itemValues: unknown[] = [];
      const itemPlaceholders: string[] = [];

      personalizedItems.forEach((item, idx: number) => {
        const b = idx * 18;
        itemPlaceholders.push(
          `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, ` +
          `$${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, ` +
          `$${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, ` +
          `$${b + 16}, $${b + 17}, $${b + 18})`
        );
        itemValues.push(
          orgId,
          briefId,
          item.cyber_signal_id,
          item.category,
          item.relevance,
          item.title,
          item.summary,
          item.affected_cve,
          item.affected_vendor,
          item.source_slug,
          item.signal_type,
          item.severity,
          item.sort_order,
          item.why_it_matters ?? null,
          item.recommended_actions ?? null,
          item.analyst_notes ?? null,
          item.is_personalized,
          item.platform_context ? JSON.stringify(item.platform_context) : null
        );
      });

      await client.query(
        `INSERT INTO intelligence_brief_items
           (organization_id, brief_id, cyber_signal_id, category, relevance,
            title, summary, affected_cve, affected_vendor, source_slug,
            signal_type, severity, sort_order,
            why_it_matters, recommended_actions, analyst_notes,
            is_personalized, platform_context)
         VALUES ${itemPlaceholders.join(", ")}`,
        itemValues
      );
    }

    // Rebuild content_json/markdown from personalized items
    const result = {
      ...base,
      items: personalizedItems
    };

    // Update brief to published — encrypt content_json before storage.
    // JSON.stringify wraps the encrypted string so PostgreSQL accepts it as a valid JSONB value.
    const contentJsonStr = JSON.stringify(encryptField(JSON.stringify(result.content_json)));

    await client.query(
      `UPDATE intelligence_briefs
       SET
         status           = 'published',
         signal_count     = $2,
         item_count       = $3,
         content_json     = $4::jsonb,
         content_markdown = $5,
         generated_at     = NOW(),
         published_at     = NOW(),
         updated_at       = NOW()
       WHERE id = $1`,
      [
        briefId,
        result.signal_count,
        result.item_count,
        contentJsonStr,
        result.content_markdown
      ]
    );

    await client.query("COMMIT");

    // Return the completed brief
    const briefResult = await pg.query<{
      id: string;
      period_start: string;
      period_end: string;
      status: string;
      signal_count: string;
      item_count: string;
      generated_at: string | null;
      published_at: string | null;
      created_at: string;
    }>(
      `SELECT id, period_start, period_end, status, signal_count, item_count,
              generated_at, published_at, created_at
       FROM intelligence_briefs
       WHERE id = $1`,
      [briefId]
    );

    const brief = briefResult.rows[0]!;

    writeAuditEvent({
      organizationId: orgId,
      actorApiKeyId: (req as any).apiKey?.id ?? null,
      actorUserId: null,
      eventType: "intelligence_brief.generated",
      resourceType: "intelligence_brief",
      resourceId: brief.id,
      payload: {
        signal_count: parseInt(brief.signal_count, 10),
        item_count: parseInt(brief.item_count, 10)
      },
      ipAddress: req.ip ?? null
    });

    return res.status(201).json({
      id: brief.id,
      period_start: brief.period_start,
      period_end: brief.period_end,
      status: brief.status,
      signal_count: parseInt(brief.signal_count, 10),
      item_count: parseInt(brief.item_count, 10),
      generated_at: brief.generated_at,
      published_at: brief.published_at,
      created_at: brief.created_at
    });
  } catch (err) {
    await client.query("ROLLBACK");

    // Mark brief as failed if we have a briefId
    try {
      await pg.query(
        `UPDATE intelligence_briefs
         SET status = 'failed', updated_at = NOW()
         WHERE organization_id = $1
           AND status = 'generating'`,
        [orgId]
      );
    } catch (_) {
      // best effort
    }

    logger.error(
      { event: "intelligence_brief_generate_failed", orgId, err },
      "POST /api/intelligence-briefs/generate failed"
    );

    return res.status(500).json({ error: "internal_error" });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /api/intelligence-briefs/subscribers
// Add a subscriber to receive Intelligence Briefs for this org.
// Upserts on (organization_id, email): reactivates if previously unsubscribed.
// ---------------------------------------------------------------------------

router.post("/intelligence-briefs/subscribers", requireEntitlement("standard"), async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;

  const rawEmail = String(req.body?.email ?? "").trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes("@")) {
    return res.status(400).json({ error: "valid_email_required" });
  }

  const name =
    typeof req.body?.name === "string" && req.body.name.trim().length > 0
      ? req.body.name.trim()
      : null;

  try {
    const result = await pg.query<{ id: string; email: string; name: string | null; active: boolean; subscribed_at: string }>(
      `INSERT INTO intelligence_brief_subscribers
         (organization_id, email, name, active, subscribed_at, unsubscribed_at)
       VALUES ($1, $2, $3, TRUE, NOW(), NULL)
       ON CONFLICT (organization_id, email) DO UPDATE
         SET active          = TRUE,
             name            = COALESCE(EXCLUDED.name, intelligence_brief_subscribers.name),
             unsubscribed_at = NULL,
             updated_at      = NOW()
       RETURNING id, email, name, active, subscribed_at`,
      [orgId, rawEmail, name]
    );

    return res.status(201).json(result.rows[0]!);
  } catch (err) {
    logger.error(
      { event: "brief_subscriber_add_failed", orgId, err },
      "POST /api/intelligence-briefs/subscribers failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence-briefs/subscribers
// List active subscribers for this org.
// IMPORTANT: defined before GET /:id to prevent Express matching
// "subscribers" as a brief UUID parameter.
// ---------------------------------------------------------------------------

router.get("/intelligence-briefs/subscribers", async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;

  const includeInactive = req.query["include_inactive"] === "true";

  try {
    const conditions = ["organization_id = $1"];
    const params: unknown[] = [orgId];

    if (!includeInactive) {
      conditions.push("active = TRUE");
    }

    const result = await pg.query<{
      id: string;
      email: string;
      name: string | null;
      active: boolean;
      subscribed_at: string;
      unsubscribed_at: string | null;
    }>(
      `SELECT id, email, name, active, subscribed_at, unsubscribed_at
       FROM intelligence_brief_subscribers
       WHERE ${conditions.join(" AND ")}
       ORDER BY subscribed_at ASC`,
      params
    );

    return res.status(200).json({ subscribers: result.rows });
  } catch (err) {
    logger.error(
      { event: "brief_subscribers_list_failed", orgId, err },
      "GET /api/intelligence-briefs/subscribers failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/intelligence-briefs/subscribers/:id
// Soft-unsubscribe: sets active=false and unsubscribed_at=NOW().
// Hard delete is intentionally not supported — preserves audit history.
// ---------------------------------------------------------------------------

router.delete("/intelligence-briefs/subscribers/:id", requireEntitlement("standard"), async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;
  const { id: subscriberId } = req.params as { id: string };

  if (!UUID_RE.test(subscriberId)) {
    return res.status(400).json({ error: "invalid_subscriber_id" });
  }

  try {
    const result = await pg.query<{ id: string }>(
      `UPDATE intelligence_brief_subscribers
       SET active          = FALSE,
           unsubscribed_at = NOW(),
           updated_at      = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [subscriberId, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "subscriber_not_found" });
    }

    return res.status(200).json({ id: subscriberId, active: false });
  } catch (err) {
    logger.error(
      { event: "brief_subscriber_unsubscribe_failed", orgId, subscriberId, err },
      "DELETE /api/intelligence-briefs/subscribers/:id failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence-briefs/subscribers/:id/preferences
// Return a subscriber's current delivery preferences.
// IMPORTANT: defined before /:id routes.
// ---------------------------------------------------------------------------

router.get("/intelligence-briefs/subscribers/:id/preferences", async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;
  const { id: subscriberId } = req.params;

  if (!UUID_RE.test(subscriberId)) {
    return res.status(400).json({ error: "invalid_subscriber_id" });
  }

  try {
    const result = await pg.query<{
      id: string;
      email: string;
      min_severity: string;
      categories: string[] | null;
      notify_vendor_matches_only: boolean;
    }>(
      `SELECT id, email, min_severity, categories, notify_vendor_matches_only
       FROM intelligence_brief_subscribers
       WHERE id = $1 AND organization_id = $2`,
      [subscriberId, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "subscriber_not_found" });
    }

    return res.status(200).json(result.rows[0]!);
  } catch (err) {
    logger.error(
      { event: "brief_subscriber_prefs_get_failed", orgId, subscriberId, err },
      "GET /api/intelligence-briefs/subscribers/:id/preferences failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/intelligence-briefs/subscribers/:id/preferences
// Update a subscriber's delivery preferences (partial update supported).
//
// Accepted fields:
//   min_severity              — 'Critical' | 'High' | 'Moderate' | 'Low'
//   categories                — string[] of valid categories, or null (all)
//   notify_vendor_matches_only — boolean
// ---------------------------------------------------------------------------

const VALID_PREF_SEVERITIES = new Set(["Critical", "High", "Moderate", "Low"]);
const VALID_PREF_CATEGORIES = new Set([
  "vulnerability",
  "threat_actor",
  "vendor_incident",
  "regulatory",
  "general"
]);

router.patch("/intelligence-briefs/subscribers/:id/preferences", requireEntitlement("standard"), async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;
  const { id: subscriberId } = req.params as { id: string };

  if (!UUID_RE.test(subscriberId)) {
    return res.status(400).json({ error: "invalid_subscriber_id" });
  }

  const body = req.body ?? {};

  // Validate and collect updates
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if ("min_severity" in body) {
    if (!VALID_PREF_SEVERITIES.has(body.min_severity)) {
      return res.status(400).json({
        error: "invalid_min_severity",
        message: "min_severity must be one of: Critical, High, Moderate, Low"
      });
    }
    values.push(body.min_severity);
    setClauses.push(`min_severity = $${values.length}`);
  }

  if ("categories" in body) {
    const cats = body.categories;
    if (cats === null || cats === undefined) {
      values.push(null);
      setClauses.push(`categories = $${values.length}`);
    } else if (!Array.isArray(cats)) {
      return res.status(400).json({ error: "categories_must_be_array_or_null" });
    } else {
      for (const cat of cats) {
        if (!VALID_PREF_CATEGORIES.has(cat)) {
          return res.status(400).json({
            error: "invalid_category",
            message: `Unknown category: ${String(cat)}. Valid: ${[...VALID_PREF_CATEGORIES].join(", ")}`
          });
        }
      }
      values.push(cats.length > 0 ? cats : null);
      setClauses.push(`categories = $${values.length}`);
    }
  }

  if ("notify_vendor_matches_only" in body) {
    if (typeof body.notify_vendor_matches_only !== "boolean") {
      return res.status(400).json({ error: "notify_vendor_matches_only_must_be_boolean" });
    }
    values.push(body.notify_vendor_matches_only);
    setClauses.push(`notify_vendor_matches_only = $${values.length}`);
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: "no_valid_fields_to_update" });
  }

  setClauses.push("updated_at = NOW()");

  values.push(subscriberId);
  const idParam = values.length;
  values.push(orgId);
  const orgParam = values.length;

  try {
    const updateResult = await pg.query<{ id: string }>(
      `UPDATE intelligence_brief_subscribers
       SET ${setClauses.join(", ")}
       WHERE id = $${idParam} AND organization_id = $${orgParam}
       RETURNING id`,
      values
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: "subscriber_not_found" });
    }

    // Return the full updated preferences
    const prefs = await pg.query<{
      id: string;
      email: string;
      min_severity: string;
      categories: string[] | null;
      notify_vendor_matches_only: boolean;
    }>(
      `SELECT id, email, min_severity, categories, notify_vendor_matches_only
       FROM intelligence_brief_subscribers
       WHERE id = $1`,
      [subscriberId]
    );

    return res.status(200).json(prefs.rows[0]!);
  } catch (err) {
    logger.error(
      { event: "brief_subscriber_prefs_patch_failed", orgId, subscriberId, err },
      "PATCH /api/intelligence-briefs/subscribers/:id/preferences failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/intelligence-briefs/:id/send
// Trigger delivery of a published brief to all active subscribers.
// ---------------------------------------------------------------------------

router.post("/intelligence-briefs/:id/send", requireEntitlement("standard"), async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;
  const { id } = req.params as { id: string };

  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "invalid_brief_id" });
  }

  try {
    const result = await sendBrief(id, orgId);

    // 500 when all sends failed — could be misconfiguration, network error, or
    // Resend rejection; we cannot distinguish without richer error data from
    // sendBrief(). 502 is reserved for cases where Resend itself returns a
    // non-200 and that is explicitly surfaced to this layer.
    const status = result.skipped ? 200 : result.failed > 0 && result.sent === 0 ? 500 : 200;

    if (!result.skipped) {
      writeAuditEvent({
        organizationId: orgId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: null,
        eventType: "intelligence_brief.sent",
        resourceType: "intelligence_brief",
        resourceId: id,
        payload: { sent: result.sent, failed: result.failed, skipped: result.skipped },
        ipAddress: req.ip ?? null
      });
    }

    return res.status(status).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg === "brief_not_found") {
      return res.status(404).json({ error: "brief_not_found" });
    }
    if (msg.startsWith("brief_not_published")) {
      return res.status(409).json({ error: msg });
    }

    logger.error(
      { event: "brief_send_failed", orgId, briefId: id, err },
      "POST /api/intelligence-briefs/:id/send failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence-briefs
// Archive list — cursor-paginated, ordered by period_end DESC (most recent
// coverage period first). Supports ?status filter; defaults to all statuses.
//
// Cursor fields: cursor_period_end (ISO 8601) + cursor_id (UUID).
// ---------------------------------------------------------------------------

router.get("/intelligence-briefs", async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;

  const rawLimit = parseInt(String(req.query["limit"] ?? DEFAULT_LIMIT), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);

  const cursorPeriodEnd = req.query["cursor_period_end"] as string | undefined;
  const cursorId = req.query["cursor_id"] as string | undefined;

  const hasCursor =
    typeof cursorPeriodEnd === "string" &&
    typeof cursorId === "string" &&
    UUID_RE.test(cursorId);

  const statusFilter = req.query["status"] as string | undefined;
  const validStatuses = new Set(["draft", "generating", "published", "failed"]);

  try {
    const params: unknown[] = [orgId, limit + 1];
    const conditions: string[] = ["organization_id = $1"];

    if (statusFilter && validStatuses.has(statusFilter)) {
      params.push(statusFilter);
      conditions.push(`status = $${params.length}`);
    }

    if (hasCursor) {
      params.push(cursorPeriodEnd!, cursorId!);
      conditions.push(
        `(period_end, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
      );
    }

    const whereClause = conditions.join(" AND ");

    const result = await pg.query<{
      id: string;
      period_start: string;
      period_end: string;
      status: string;
      signal_count: string;
      item_count: string;
      generated_at: string | null;
      published_at: string | null;
      created_at: string;
    }>(
      `SELECT id, period_start, period_end, status, signal_count, item_count,
              generated_at, published_at, created_at
       FROM intelligence_briefs
       WHERE ${whereClause}
       ORDER BY period_end DESC, id DESC
       LIMIT $2`,
      params
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const briefs = page.map((b) => ({
      id: b.id,
      period_start: b.period_start,
      period_end: b.period_end,
      status: b.status,
      signal_count: parseInt(b.signal_count, 10),
      item_count: parseInt(b.item_count, 10),
      generated_at: b.generated_at,
      published_at: b.published_at,
      created_at: b.created_at
    }));

    const lastRow = page[page.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? { cursor_period_end: lastRow.period_end, cursor_id: lastRow.id }
        : null;

    return res.status(200).json({ briefs, next_cursor: nextCursor });
  } catch (err) {
    logger.error(
      { event: "intelligence_briefs_list_failed", orgId, err },
      "GET /api/intelligence-briefs failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intelligence-briefs/:id
// Returns brief + all items (sorted by sort_order).
// ---------------------------------------------------------------------------

router.get("/intelligence-briefs/:id", async (req, res) => {
  const orgId = (req as any).organizationContext?.organizationId as string;
  const { id } = req.params;

  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "invalid_brief_id" });
  }

  try {
    const briefResult = await pg.query<{
      id: string;
      period_start: string;
      period_end: string;
      status: string;
      signal_count: string;
      item_count: string;
      content_json: unknown;
      content_markdown: string;
      generated_at: string | null;
      published_at: string | null;
      created_at: string;
    }>(
      `SELECT id, period_start, period_end, status, signal_count, item_count,
              content_json, content_markdown, generated_at, published_at, created_at
       FROM intelligence_briefs
       WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );

    if (briefResult.rows.length === 0) {
      return res.status(404).json({ error: "brief_not_found" });
    }

    const brief = briefResult.rows[0]!;

    const itemsResult = await pg.query<{
      id: string;
      category: string;
      relevance: string;
      title: string;
      summary: string;
      affected_cve: string | null;
      affected_vendor: string | null;
      source_slug: string | null;
      signal_type: string | null;
      severity: string | null;
      cyber_signal_id: string | null;
      ingestion_timestamp: string | null;
      sort_order: string;
      why_it_matters: string | null;
      recommended_actions: string | null;
      analyst_notes: string | null;
    }>(
      `SELECT id, category, relevance, title, summary, affected_cve, affected_vendor,
              source_slug, signal_type, severity, cyber_signal_id,
              ingestion_timestamp, sort_order,
              why_it_matters, recommended_actions, analyst_notes
       FROM intelligence_brief_items
       WHERE brief_id = $1 AND organization_id = $2
       ORDER BY sort_order ASC`,
      [id, orgId]
    );

    return res.status(200).json({
      id: brief.id,
      period_start: brief.period_start,
      period_end: brief.period_end,
      status: brief.status,
      signal_count: parseInt(brief.signal_count, 10),
      item_count: parseInt(brief.item_count, 10),
      content_json: parseContentJson(brief.content_json),
      content_markdown: brief.content_markdown,
      generated_at: brief.generated_at,
      published_at: brief.published_at,
      created_at: brief.created_at,
      items: itemsResult.rows.map((item) => ({
        id: item.id,
        category: item.category,
        relevance: item.relevance,
        title: item.title,
        summary: item.summary,
        affected_cve: item.affected_cve,
        affected_vendor: item.affected_vendor,
        source_slug: item.source_slug,
        signal_type: item.signal_type,
        severity: item.severity,
        cyber_signal_id: item.cyber_signal_id,
        ingestion_timestamp: item.ingestion_timestamp,
        sort_order: parseInt(item.sort_order, 10),
        why_it_matters: item.why_it_matters,
        recommended_actions: item.recommended_actions,
        analyst_notes: item.analyst_notes
      }))
    });
  } catch (err) {
    logger.error(
      { event: "intelligence_brief_get_failed", orgId, briefId: id, err },
      "GET /api/intelligence-briefs/:id failed"
    );
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
