/**
 * briefPersonalizationService.ts — Brief Pro personalization for Intelligence Brief items.
 *
 * Matches brief items against the org's live platform data (vendors, open risks,
 * AI systems, obligations) and marks each item as personalized when a match is
 * found. The platform_context payload records exactly what matched so the UI and
 * email layer can render "This affects your vendor: Cisco" style callouts.
 *
 * PIPELINE POSITION
 * -----------------
 * Called after enrichBriefItems() and before the DB INSERT in the generate route:
 *   1. generateBrief()        → base items
 *   2. enrichBriefItems()     → why_it_matters, recommended_actions
 *   3. personalizeBriefItems() → is_personalized, platform_context  ← this file
 *   4. INSERT intelligence_brief_items
 *
 * BATCH QUERY STRATEGY
 * --------------------
 * Four parallel queries fetch all platform entities in one round-trip. Matching
 * is then done entirely in memory. This avoids N per-item DB queries regardless
 * of how many items the brief contains.
 *
 * MATCHING RULES
 * --------------
 * Vendor match:
 *   item.affected_vendor ILIKE vendor.name
 *   OR vendor.name (≥3 chars) appears in item.title or item.summary (case-insensitive)
 *
 * AI system match:
 *   Same as vendor match but against ai_systems.name
 *
 * Risk match (CVE-keyed):
 *   item.affected_cve matches a CVE extracted from any open risk's title or description
 *
 * Obligation match (keyword-based, regulatory items only):
 *   Significant words (>4 chars, not in common-word stop list) from the obligation
 *   title appear in item.title or item.summary
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * personalizeItem()       — pure, no I/O; unit-testable.
 * personalizeItems()      — pure, no I/O; unit-testable.
 * fetchOrgPlatformContext() — I/O; fetches entities from DB.
 * personalizeBriefItems() — entry point; combines I/O + pure.
 */

import type { BriefItem } from "./intelligenceBriefGenerator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VendorRecord = {
  id: string;
  name: string;
};

export type RiskRecord = {
  id: string;
  title: string;
  description: string | null;
};

export type AiSystemRecord = {
  id: string;
  name: string;
};

export type ObligationRecord = {
  id: string;
  title: string;
  description: string | null;
};

export type OrgPlatformContext = {
  vendors: VendorRecord[];
  risks: RiskRecord[];
  ai_systems: AiSystemRecord[];
  obligations: ObligationRecord[];
};

export type PlatformContext = {
  matched_vendors: Array<{ id: string; name: string }>;
  matched_risks: Array<{ id: string; title: string }>;
  matched_ai_systems: Array<{ id: string; name: string }>;
  matched_obligations: Array<{ id: string; title: string }>;
};

export type PersonalizedBriefItem = BriefItem & {
  is_personalized: boolean;
  platform_context: PlatformContext | null;
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Lowercase and collapse whitespace — consistent base for all text comparisons.
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Check whether `name` appears as a substring in `haystack` (case-insensitive).
 * Names shorter than 3 characters are never matched to avoid false positives
 * (e.g., "HP" matching "shape").
 */
export function nameAppearsIn(haystack: string, name: string): boolean {
  if (name.trim().length < 3) return false;
  return normalizeText(haystack).includes(normalizeText(name));
}

// ---------------------------------------------------------------------------
// CVE extraction
// ---------------------------------------------------------------------------

const CVE_EXTRACT_RE = /CVE-\d{4}-\d{4,}/gi;

/**
 * Extract all CVE IDs from a text string, normalised to uppercase.
 */
export function extractCves(text: string): Set<string> {
  const matches = text.match(CVE_EXTRACT_RE) ?? [];
  return new Set(matches.map((m) => m.toUpperCase()));
}

// ---------------------------------------------------------------------------
// Obligation keyword matching
// ---------------------------------------------------------------------------

/**
 * Common words excluded from obligation keyword extraction.
 * Prevents "policy" or "compliance" alone triggering a match.
 */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "have", "into",
  "been", "will", "shall", "must", "should", "their", "which", "other",
  "under", "about", "these", "those", "where", "when", "them", "then",
  "also", "such", "each", "than", "data", "information", "organization",
  "organizations", "system", "systems", "security", "compliance",
  "requirement", "requirements", "standard", "standards", "regulation",
  "regulations", "policy", "policies", "control", "controls", "framework",
  "guidance", "guidelines"
]);

/**
 * Extract significant keywords from an obligation title.
 * Returns words that are >4 chars and not in the stop-word list.
 */
export function extractObligationKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Per-item match functions (all pure)
// ---------------------------------------------------------------------------

/**
 * Returns every vendor whose name appears in the item's affected_vendor field,
 * title, or summary.
 */
export function matchVendors(
  item: BriefItem,
  vendors: VendorRecord[]
): VendorRecord[] {
  if (vendors.length === 0) return [];
  const haystack = [
    item.affected_vendor ?? "",
    item.title,
    item.summary
  ].join(" ");

  return vendors.filter((v) => nameAppearsIn(haystack, v.name));
}

/**
 * Returns every AI system whose name appears in the item's affected_vendor field,
 * title, or summary.
 */
export function matchAiSystems(
  item: BriefItem,
  aiSystems: AiSystemRecord[]
): AiSystemRecord[] {
  if (aiSystems.length === 0) return [];
  const haystack = [
    item.affected_vendor ?? "",
    item.title,
    item.summary
  ].join(" ");

  return aiSystems.filter((ai) => nameAppearsIn(haystack, ai.name));
}

/**
 * Returns every open risk whose title or description mentions the item's CVE.
 * Returns empty if the item has no affected_cve.
 */
export function matchRisks(
  item: BriefItem,
  risks: RiskRecord[]
): RiskRecord[] {
  if (risks.length === 0 || !item.affected_cve) return [];
  const itemCve = item.affected_cve.toUpperCase();

  return risks.filter((r) => {
    const riskText = [r.title, r.description ?? ""].join(" ");
    const riskCves = extractCves(riskText);
    return riskCves.has(itemCve);
  });
}

/**
 * Returns every obligation whose significant keywords appear in the item text.
 * Only active on items categorised as 'regulatory' — obligation matching is
 * meaningful for regulatory signals, not for generic CVE items.
 */
export function matchObligations(
  item: BriefItem,
  obligations: ObligationRecord[]
): ObligationRecord[] {
  if (obligations.length === 0 || item.category !== "regulatory") return [];
  const itemText = normalizeText([item.title, item.summary].join(" "));

  return obligations.filter((obl) => {
    const keywords = extractObligationKeywords(obl.title);
    // Require at least one meaningful keyword match
    return keywords.length > 0 && keywords.some((kw) => itemText.includes(kw));
  });
}

// ---------------------------------------------------------------------------
// personalizeItem  (pure)
// ---------------------------------------------------------------------------

/**
 * Apply personalization to a single brief item.
 *
 * Runs all four match functions and assembles the PlatformContext.
 * Sets is_personalized = true when at least one match was found.
 * platform_context is null when is_personalized = false.
 */
export function personalizeItem(
  item: BriefItem,
  context: OrgPlatformContext
): PersonalizedBriefItem {
  const matchedVendors = matchVendors(item, context.vendors);
  const matchedAiSystems = matchAiSystems(item, context.ai_systems);
  const matchedRisks = matchRisks(item, context.risks);
  const matchedObligations = matchObligations(item, context.obligations);

  const hasMatch =
    matchedVendors.length > 0 ||
    matchedAiSystems.length > 0 ||
    matchedRisks.length > 0 ||
    matchedObligations.length > 0;

  const platformContext: PlatformContext | null = hasMatch
    ? {
        matched_vendors: matchedVendors.map((v) => ({ id: v.id, name: v.name })),
        matched_risks: matchedRisks.map((r) => ({ id: r.id, title: r.title })),
        matched_ai_systems: matchedAiSystems.map((ai) => ({ id: ai.id, name: ai.name })),
        matched_obligations: matchedObligations.map((o) => ({ id: o.id, title: o.title }))
      }
    : null;

  return {
    ...item,
    is_personalized: hasMatch,
    platform_context: platformContext
  };
}

// ---------------------------------------------------------------------------
// personalizeItems  (pure)
// ---------------------------------------------------------------------------

/**
 * Apply personalization to a batch of brief items against the org's platform data.
 *
 * Pure — no I/O. Used directly in unit tests and called by personalizeBriefItems().
 */
export function personalizeItems(
  items: BriefItem[],
  context: OrgPlatformContext
): PersonalizedBriefItem[] {
  return items.map((item) => personalizeItem(item, context));
}

// ---------------------------------------------------------------------------
// fetchOrgPlatformContext  (I/O)
// ---------------------------------------------------------------------------

/**
 * Batch-fetch all platform entities for an org in four parallel queries.
 * Callers should not invoke per-item queries; this single round-trip provides
 * all data needed for the in-memory matching step.
 */
export async function fetchOrgPlatformContext(
  orgId: string
): Promise<OrgPlatformContext> {
  // Lazy import so the pure-function exports can be imported by unit tests
  // without triggering the DATABASE_URL check at module load time. withTenant
  // is pulled from the SAME dynamic import (not a top-level import) so that
  // test-load contract is preserved.
  const { pg, withTenant } = await import("../infra/postgres.js");

  // RLS adoption (A04-G1 gap C'): scope the four reads to the org so they route
  // through the tenant client after the app_request flip. Inside a withTenant
  // scope every pg.query() targets the SINGLE tenant client; node-postgres
  // cannot multiplex concurrent queries on one client (the previous Promise.all
  // would throw under pg@9), so the reads are issued sequentially. They are
  // independent SELECTs with no inter-query dependency — order does not affect
  // results. No external I/O runs inside the scope.
  return withTenant(orgId, async () => {
    const vendorsResult = await pg.query<VendorRecord>(
      `SELECT id, name
       FROM vendors
       WHERE organization_id = $1
         AND status = 'active'
       ORDER BY name`,
      [orgId]
    );

    const risksResult = await pg.query<RiskRecord>(
      `SELECT id, title, description
       FROM risks
       WHERE organization_id = $1
         AND status = 'open'`,
      [orgId]
    );

    const aiSystemsResult = await pg.query<AiSystemRecord>(
      `SELECT id, name
       FROM ai_systems
       WHERE organization_id = $1
       ORDER BY name`,
      [orgId]
    );

    const obligationsResult = await pg.query<ObligationRecord>(
      `SELECT id, title, description
       FROM obligations
       WHERE organization_id = $1`,
      [orgId]
    );

    return {
      vendors: vendorsResult.rows,
      risks: risksResult.rows,
      ai_systems: aiSystemsResult.rows,
      obligations: obligationsResult.rows
    };
  });
}

// ---------------------------------------------------------------------------
// personalizeBriefItems  (entry point)
// ---------------------------------------------------------------------------

/**
 * Personalize a batch of brief items for an org.
 *
 * Fetches platform context once via a single parallel batch query, then runs
 * all matching in memory. Non-fatal: if any DB query fails, the error propagates
 * to the caller (the generate route), which records a brief failure.
 *
 * @param items  Enriched brief items from enrichBriefItems().
 * @param orgId  Organization to match against.
 * @returns      Items with is_personalized and platform_context populated.
 */
export async function personalizeBriefItems(
  items: BriefItem[],
  orgId: string
): Promise<PersonalizedBriefItem[]> {
  if (items.length === 0) return [];

  const context = await fetchOrgPlatformContext(orgId);
  return personalizeItems(items, context);
}
