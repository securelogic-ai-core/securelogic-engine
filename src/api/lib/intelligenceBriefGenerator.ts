/**
 * intelligenceBriefGenerator.ts — Pure generation service for Intelligence Briefs.
 *
 * No I/O. All functions are pure and fully unit-testable.
 *
 * BRIEF PIPELINE
 * --------------
 * 1. Pull cyber_signals for the org in the given time window.
 * 2. Score each signal by relevance.
 * 3. Bucket signals by category.
 * 4. Build brief items from each signal.
 * 5. Produce content_json (structured) and content_markdown (formatted).
 *
 * This module is intentionally isolated from posture, findings, and risk tables.
 * It reads from cyber_signals only and writes to intelligence_brief_items.
 *
 * CATEGORY MAPPING
 * ----------------
 *   cve | patch | advisory | patch_advisory → 'vulnerability'
 *   threat_actor | malware | geopolitical
 *     | data_exposure                       → 'threat_actor'
 *   breach | third_party_breach             → 'vendor_incident'
 *   regulatory_change                       → 'regulatory'
 *   (anything else)                         → 'general'
 *
 * RELEVANCE SCORING
 * -----------------
 *   Critical                            → 'high'
 *   High + CVE present                  → 'high'
 *   High (no CVE)                       → 'medium'
 *   Moderate + CVE present              → 'medium'
 *   Low                                 → 'low'
 *   Moderate (no CVE)                   → 'low'
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logger } from "../infra/logger.js";
import type { BriefSynthesis } from "./briefSynthesizer.js";

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefCategory = "vulnerability" | "threat_actor" | "vendor_incident" | "regulatory" | "general";
export type BriefRelevance = "high" | "medium" | "low";

/**
 * Per-item time-horizon urgency band, classified by enrichItemWithClaude.
 *
 *   immediate — act this week  (KEV, active exploitation, federal deadline,
 *                                CVSS 9+ with public PoC and likely vendor presence)
 *   near_term — act this month (critical/high vulns with patches available,
 *                                exploitation likely but not yet confirmed,
 *                                near-term regulatory deadlines)
 *   far_term  — monitor        (emerging patterns, advisory-only items,
 *                                longer-horizon regulatory shifts)
 *
 * NULL on items generated before the urgency column was added (2026-06-02).
 */
export type BriefUrgency = "immediate" | "near_term" | "far_term";

/** Minimal shape required from the cyber_signals DB row */
export type CyberSignalForBrief = {
  id: string;
  signal_type: string;
  severity: string;
  normalized_summary: string;
  affected_cve: string | null;
  affected_vendor: string | null;
  source: string;
  ingestion_timestamp: string;
  /**
   * Source-feed payload as stored in cyber_signals.raw_payload (jsonb).
   * The worker bridge writes { title, summary } here; engine adapters
   * write source-specific shapes that may or may not include `title`.
   * Optional in the type because tests construct fixtures inline; in
   * production the column is always populated.
   */
  raw_payload?: Record<string, unknown> | null;
};

export type BriefItem = {
  cyber_signal_id: string;
  category: BriefCategory;
  relevance: BriefRelevance;
  title: string;
  summary: string;
  affected_cve: string | null;
  affected_vendor: string | null;
  source_slug: string;
  signal_type: string;
  severity: string;
  ingestion_timestamp: string;
  sort_order: number;
  /** Populated by enrichBriefItems() after generation. Null until enriched. */
  analysis?: string | null;
  /** Populated by enrichBriefItems() after generation. Null until enriched. */
  why_it_matters?: string | null;
  /** Populated by enrichBriefItems() after generation. Null until enriched. */
  recommended_actions?: string | null;
  /** Optional freeform analyst context. */
  analyst_notes?: string | null;
  /**
   * Time-horizon priority band. Populated by enrichBriefItems() after
   * generation; falls back to 'near_term' on enrichment failure (the
   * conservative default — same as treating an unknown item as "act this
   * month"). Null only on items loaded from briefs generated before the
   * urgency column existed.
   */
  urgency?: BriefUrgency | null;
  /**
   * Other sources that ingested the same CVE and were collapsed into this
   * canonical item by the CVE-merge pass in buildBriefItems. Distinct,
   * sorted by source priority (highest first). Undefined when no merge
   * occurred (the common case: most items have no corroborators).
   *
   * Carried through content_json only — not persisted to the per-row
   * intelligence_brief_items table (no migration). Frontend may read it
   * off the content_json blob to render a "seen in N sources" indicator.
   */
  corroborating_sources?: string[];
};

export type BriefCategoryGroup = {
  category: BriefCategory;
  label: string;
  items: BriefItem[];
};

export type BriefContentJson = {
  period_start: string;
  period_end: string;
  signal_count: number;
  item_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  categories: BriefCategoryGroup[];
  /**
   * Brief-level synthesis (thesis, executive summary, cross-domain analysis,
   * action summary). Populated by callers via runSynthesisSafely after item
   * enrichment. Optional/nullable so existing briefs without synthesis still
   * conform to this type when read back from the DB.
   */
  synthesis?: BriefSynthesis | null;
};

// ---------------------------------------------------------------------------
// Hard caps and bucket targets
// ---------------------------------------------------------------------------

/**
 * Hard cap on items in any single brief. Goal: a reader scans the entire
 * brief in ~60 seconds. Capping the per-brief item count is enforced by
 * capByUrgencyBuckets after enrichment classifies urgency.
 */
export const BRIEF_MAX_ITEMS = 12;

/**
 * Pre-enrichment shortlist size. ~2× BRIEF_MAX_ITEMS so the post-enrichment
 * urgency-bucket pass has headroom to fill all three zones, while still
 * saving ~60% of Claude API cost vs enriching everything.
 */
export const ENRICHMENT_SHORTLIST = 24;

/**
 * Per-zone target counts. Sum equals BRIEF_MAX_ITEMS. When a zone is
 * under-supplied the slack flows to the middle (immediate→near, far→near).
 * When near is under-supplied its slack flows down to far. Total kept
 * never exceeds BRIEF_MAX_ITEMS; under-supply across all zones produces
 * a smaller brief (graceful degradation).
 */
export const URGENCY_BUCKET_TARGETS: Record<BriefUrgency, number> = {
  immediate: 3,
  near_term: 7,
  far_term: 2
};

// ---------------------------------------------------------------------------
// Category labels (for human-readable output)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<BriefCategory, string> = {
  vulnerability: "Vulnerabilities & Patches",
  threat_actor: "Threat Actors & Malware",
  vendor_incident: "Vendor & Supply Chain Incidents",
  regulatory: "Regulatory & Compliance Updates",
  general: "General Intelligence"
};

// Category sort order (high-signal categories first)
const CATEGORY_ORDER: BriefCategory[] = [
  "vulnerability",
  "threat_actor",
  "vendor_incident",
  "regulatory",
  "general"
];

// ---------------------------------------------------------------------------
// mapSignalToCategory
// ---------------------------------------------------------------------------

/**
 * Map a signal_type string to a brief category bucket.
 *
 * @example
 *   mapSignalToCategory("cve")          // "vulnerability"
 *   mapSignalToCategory("threat_actor") // "threat_actor"
 *   mapSignalToCategory("breach")       // "vendor_incident"
 *   mapSignalToCategory("unknown")      // "general"
 */
export function mapSignalToCategory(signalType: string): BriefCategory {
  switch (signalType.toLowerCase()) {
    case "cve":
    case "patch":
    case "advisory":
    case "patch_advisory":
      return "vulnerability";

    case "threat_actor":
    case "malware":
    case "geopolitical":
    case "data_exposure":
      return "threat_actor";

    case "breach":
    case "third_party_breach":
      return "vendor_incident";

    case "regulatory_change":
    case "regulatory":
      return "regulatory";

    case "vendor_incident":
      return "vendor_incident";

    case "general":
      return "general";

    default:
      return "general";
  }
}

// ---------------------------------------------------------------------------
// scoreRelevance
// ---------------------------------------------------------------------------

/**
 * Score a signal's relevance to the brief based on severity and CVE presence.
 *
 * Rules (in priority order):
 *   1. Critical severity                → 'high'
 *   2. High severity + CVE present      → 'high'
 *   3. High severity (no CVE)           → 'medium'
 *   4. Moderate severity + CVE present  → 'medium'
 *   5. Low severity                     → 'low'
 *   6. Moderate severity (no CVE)       → 'low'
 *
 * @example
 *   scoreRelevance("Critical", null)          // "high"
 *   scoreRelevance("High", "CVE-2024-12345")  // "high"
 *   scoreRelevance("High", null)              // "medium"
 *   scoreRelevance("Moderate", "CVE-2024-1")  // "medium"
 *   scoreRelevance("Low", null)               // "low"
 *   scoreRelevance("Moderate", null)          // "low"
 */
export function scoreRelevance(severity: string, affectedCve: string | null): BriefRelevance {
  const sev = severity.toLowerCase();
  const hasCve = affectedCve !== null && affectedCve.trim().length > 0;

  if (sev === "critical") return "high";
  if (sev === "high" && hasCve) return "high";
  if (sev === "high") return "medium";
  if (sev === "moderate" && hasCve) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Source priority ladder (for CVE-merge canonicalization)
// ---------------------------------------------------------------------------

/**
 * When the same CVE is ingested across multiple sources, the merged brief
 * item takes its primary fields from the highest-priority source (lowest
 * number wins). KEV ranks first because it carries federal due-date and
 * known-exploitation context; NVD next because it carries authoritative
 * CVSS metrics; CISA alerts third (advisory context). PSIRT vendor feeds
 * outrank generic news. Anything unknown falls to the bottom — news rows
 * are merged away in favour of canonical sources but never become canonical
 * themselves when a structured-feed alternative exists.
 *
 * Spec: docs/brief-content-audit.md §2 (Bug 2 fix scope).
 */
function sourcePriority(source: string): number {
  const s = source.toLowerCase().trim();
  if (s === "cisa_kev") return 0;
  if (s === "nvd") return 1;
  if (s === "cisa_alerts") return 2;
  if (s.startsWith("psirt_")) return 3;
  if (s.startsWith("security_news_")) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// mergeBriefItemsByCve  (pure)
// ---------------------------------------------------------------------------

/**
 * Collapse multiple BriefItems sharing the same CVE into one canonical item.
 *
 * The cyber_signals dedup_hash uniquely identifies (source, signal_type, cve,
 * vendor) per organization, which means the same CVE legitimately appears as
 * separate rows when ingested from KEV, NVD, news, etc. (preserving provenance
 * at the signal layer). At the brief layer the user wants one card per CVE.
 *
 * Algorithm:
 *   1. Partition into CVE-bearing (non-empty affected_cve) vs CVE-less.
 *   2. Group CVE-bearing items by uppercase-trimmed CVE.
 *   3. For each group, sort by [sourcePriority asc, ingestion_timestamp desc]
 *      and take the first as canonical. Distinct other source slugs become
 *      corroborating_sources, sorted by the same priority ladder.
 *   4. CVE-less items pass through unchanged.
 *
 * Order of returned items is not guaranteed; the caller re-sorts.
 */
function mergeBriefItemsByCve(items: ReadonlyArray<BriefItem>): BriefItem[] {
  const noCveItems: BriefItem[] = [];
  const groups = new Map<string, BriefItem[]>();

  for (const item of items) {
    const cveKey = item.affected_cve?.trim().toUpperCase();
    if (!cveKey) {
      noCveItems.push(item);
      continue;
    }
    const bucket = groups.get(cveKey);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(cveKey, [item]);
    }
  }

  const merged: BriefItem[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }

    const sorted = [...group].sort((a, b) => {
      const pDiff = sourcePriority(a.source_slug) - sourcePriority(b.source_slug);
      if (pDiff !== 0) return pDiff;
      return b.ingestion_timestamp.localeCompare(a.ingestion_timestamp);
    });

    const canonical = sorted[0]!;
    const others = sorted.slice(1);

    const seen = new Set<string>([canonical.source_slug]);
    const corroborating: string[] = [];
    for (const other of others) {
      if (!seen.has(other.source_slug)) {
        seen.add(other.source_slug);
        corroborating.push(other.source_slug);
      }
    }

    merged.push(
      corroborating.length > 0
        ? { ...canonical, corroborating_sources: corroborating }
        : canonical
    );
  }

  return [...merged, ...noCveItems];
}

// ---------------------------------------------------------------------------
// Composite ranking key (pre- and post-enrichment)
// ---------------------------------------------------------------------------

/**
 * Severity rank — Critical > High > Moderate > Low > unknown. Lower is
 * higher priority, so the comparator returns `a - b` for ascending sort.
 */
function severityRank(severity: string): number {
  const s = severity.toLowerCase();
  if (s === "critical") return 0;
  if (s === "high") return 1;
  if (s === "moderate") return 2;
  if (s === "low") return 3;
  return 4;
}

/**
 * Comparator used by both the pre-enrichment shortlist and the
 * post-enrichment intra-bucket ranking.
 *
 * Composite key (descending priority):
 *   1. is_kev      — items sourced from cisa_kev win (strongest "actively
 *                     exploited in the wild" signal we have)
 *   2. severity    — Critical > High > Moderate > Low
 *   3. has_cve     — CVE-bearing items beat CVE-less
 *   4. source_priority — KEV(0) > NVD(1) > CISA Alerts(2) > PSIRT(3)
 *                         > security_news_*(4) > other(5). KEV is already
 *                         tied at step 1; this disambiguates the rest.
 *   5. recency     — newer ingestion_timestamp first
 */
function compareBriefItemsForRanking(a: BriefItem, b: BriefItem): number {
  const aKev = a.source_slug === "cisa_kev" ? 1 : 0;
  const bKev = b.source_slug === "cisa_kev" ? 1 : 0;
  if (aKev !== bKev) return bKev - aKev;

  const sevDiff = severityRank(a.severity) - severityRank(b.severity);
  if (sevDiff !== 0) return sevDiff;

  const aCve = a.affected_cve && a.affected_cve.trim().length > 0 ? 1 : 0;
  const bCve = b.affected_cve && b.affected_cve.trim().length > 0 ? 1 : 0;
  if (aCve !== bCve) return bCve - aCve;

  const spDiff = sourcePriority(a.source_slug) - sourcePriority(b.source_slug);
  if (spDiff !== 0) return spDiff;

  return b.ingestion_timestamp.localeCompare(a.ingestion_timestamp);
}

// ---------------------------------------------------------------------------
// shortlistTopK  (pure)
// ---------------------------------------------------------------------------

/**
 * Pre-enrichment cap. Sort by composite ranking key, take top k. Used by
 * generateBrief() to trim the candidate set before paying Claude per-item
 * enrichment cost.
 *
 * Returns a fresh array; does not mutate input. When items.length ≤ k the
 * full input is returned (still sorted, so the caller has a stable order).
 */
export function shortlistTopK(
  items: ReadonlyArray<BriefItem>,
  k: number
): BriefItem[] {
  if (k <= 0) return [];
  const sorted = [...items].sort(compareBriefItemsForRanking);
  return sorted.length <= k ? sorted : sorted.slice(0, k);
}

// ---------------------------------------------------------------------------
// capByUrgencyBuckets  (pure)
// ---------------------------------------------------------------------------

/**
 * Post-enrichment cap. Bucket items by urgency, rank each bucket by the
 * composite key, then fill BRIEF_MAX_ITEMS slots per URGENCY_BUCKET_TARGETS
 * with spillover.
 *
 * Spillover rules (slack = unused target capacity in a zone):
 *   - immediate slack  → near_term
 *   - far_term  slack  → near_term
 *   - near_term slack  → far_term  (residual after near absorbs slack)
 *
 * Total kept ≤ BRIEF_MAX_ITEMS. If every zone is under-supplied the brief
 * comes out smaller — no synthetic backfill, no special-case.
 *
 * Items with null urgency (only possible from older code paths) are
 * treated as URGENCY_FALLBACK ("near_term") — same default the
 * enrichment fallback uses when Claude classification fails.
 *
 * Output items are emitted immediate → near_term → far_term and have
 * sort_order reassigned 0..N-1. Input items are not mutated.
 */
export function capByUrgencyBuckets(
  enriched: ReadonlyArray<BriefItem>
): {
  items: BriefItem[];
  counts: Record<BriefUrgency, number>;
} {
  const groups: Record<BriefUrgency, BriefItem[]> = {
    immediate: [],
    near_term: [],
    far_term: []
  };
  for (const item of enriched) {
    const u: BriefUrgency = item.urgency ?? URGENCY_FALLBACK;
    groups[u].push(item);
  }

  for (const key of Object.keys(groups) as BriefUrgency[]) {
    groups[key].sort(compareBriefItemsForRanking);
  }

  const T = URGENCY_BUCKET_TARGETS;

  const supplyImm = groups.immediate.length;
  const supplyNear = groups.near_term.length;
  const supplyFar = groups.far_term.length;

  const takeImm = Math.min(T.immediate, supplyImm);
  const immSlack = T.immediate - takeImm;

  const takeFarInitial = Math.min(T.far_term, supplyFar);
  const farSlack = T.far_term - takeFarInitial;

  // Near absorbs slack from both immediate and far.
  const nearEffective = T.near_term + immSlack + farSlack;
  const takeNear = Math.min(nearEffective, supplyNear);
  const nearSlack = nearEffective - takeNear;

  // Residual near slack flows to far, capped by far's remaining supply.
  const farRemaining = supplyFar - takeFarInitial;
  const takeFar = takeFarInitial + Math.min(nearSlack, farRemaining);

  const taken: BriefItem[] = [
    ...groups.immediate.slice(0, takeImm),
    ...groups.near_term.slice(0, takeNear),
    ...groups.far_term.slice(0, takeFar)
  ].map((item, i) => ({ ...item, sort_order: i }));

  return {
    items: taken,
    counts: {
      immediate: takeImm,
      near_term: takeNear,
      far_term: takeFar
    }
  };
}

// ---------------------------------------------------------------------------
// buildBriefItems
// ---------------------------------------------------------------------------

/**
 * Convert an array of cyber signal rows into sorted BriefItems.
 *
 * Pipeline:
 *   1. Map each signal 1:1 to a BriefItem.
 *   2. Merge items sharing the same CVE down to one canonical item per CVE
 *      (mergeBriefItemsByCve). Other source slugs are preserved on
 *      corroborating_sources for downstream "seen in N sources" rendering.
 *   3. Sort by relevance (high→medium→low) then ingestion_timestamp DESC.
 *   4. Assign 0-based sort_order.
 */
export function buildBriefItems(signals: ReadonlyArray<CyberSignalForBrief>): BriefItem[] {
  const RELEVANCE_RANK: Record<BriefRelevance, number> = { high: 0, medium: 1, low: 2 };

  const rawItems: BriefItem[] = signals.map((s) => ({
    cyber_signal_id: s.id,
    category: mapSignalToCategory(s.signal_type),
    relevance: scoreRelevance(s.severity, s.affected_cve),
    title: buildItemTitle(s),
    summary: s.normalized_summary,
    affected_cve: s.affected_cve,
    affected_vendor: s.affected_vendor,
    source_slug: s.source,
    signal_type: s.signal_type,
    severity: s.severity,
    ingestion_timestamp: new Date(s.ingestion_timestamp).toISOString(),
    sort_order: 0 // assigned below
  }));

  const items = mergeBriefItemsByCve(rawItems);

  items.sort((a, b) => {
    const rankDiff = RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance];
    if (rankDiff !== 0) return rankDiff;
    // Descending by ingestion_timestamp
    return b.ingestion_timestamp.localeCompare(a.ingestion_timestamp);
  });

  items.forEach((item, i) => {
    item.sort_order = i;
  });

  return items;
}

// ---------------------------------------------------------------------------
// buildItemTitle
// ---------------------------------------------------------------------------

/**
 * Some RSS source feeds (notably CISA's cybersecurity-advisories feed,
 * whose contentSnippet begins with the rendered page's "View CSAF" link
 * and "Summary" heading) inject boilerplate ahead of the real prose.
 * Strip these prefixes before using normalized_summary as a title,
 * otherwise items render with "View CSAF Summary…" as their title.
 *
 * The optional groups handle either prefix appearing alone or together.
 */
const TITLE_BOILERPLATE_RE = /^\s*(view\s+csaf\s*)?(summary\s*)?/i;

function cleanSummaryForTitle(raw: string): string {
  return raw.replace(TITLE_BOILERPLATE_RE, "").replace(/\s+/g, " ").trim();
}

/**
 * Derive a concise title for a brief item.
 *
 * Priority:
 *   1. raw_payload.title — the source-feed title preserved by the worker
 *      bridge (e.g. "ABB PCM600"). Truncated to 77 chars + "..." if > 80.
 *   2. normalized_summary, with known boilerplate prefixes stripped and
 *      whitespace collapsed, same truncation rule.
 *   3. If both are empty, build from CVE/vendor/signal_type.
 */
function buildItemTitle(signal: CyberSignalForBrief): string {
  // Stage 1 — source-feed title from raw_payload.
  const payloadTitle =
    signal.raw_payload && typeof signal.raw_payload === "object"
      ? (signal.raw_payload as Record<string, unknown>)["title"]
      : null;
  if (typeof payloadTitle === "string") {
    const trimmed = payloadTitle.trim();
    if (trimmed.length > 0) {
      return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}...`;
    }
  }

  // Stage 2 — fall back to normalized_summary with boilerplate stripped.
  const summary = cleanSummaryForTitle(signal.normalized_summary);
  if (summary.length === 0) {
    // Stage 3 — synthesize from metadata.
    const parts: string[] = [];
    if (signal.affected_cve) parts.push(signal.affected_cve);
    if (signal.affected_vendor) parts.push(signal.affected_vendor);
    parts.push(signal.signal_type.toUpperCase());
    return parts.join(" — ");
  }
  return summary.length <= 80 ? summary : `${summary.slice(0, 77)}...`;
}

// ---------------------------------------------------------------------------
// buildContentJson
// ---------------------------------------------------------------------------

/**
 * Build the structured JSON content for a brief.
 *
 * Groups items by category in canonical order. Empty categories are omitted.
 */
export function buildContentJson(
  items: ReadonlyArray<BriefItem>,
  periodStart: string,
  periodEnd: string,
  signalCount: number
): BriefContentJson {
  const grouped = new Map<BriefCategory, BriefItem[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);

  for (const item of items) {
    grouped.get(item.category)!.push(item);
  }

  const categories: BriefCategoryGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const catItems = grouped.get(cat)!;
    if (catItems.length > 0) {
      categories.push({
        category: cat,
        label: CATEGORY_LABELS[cat],
        items: catItems
      });
    }
  }

  const highCount = items.filter((i) => i.relevance === "high").length;
  const mediumCount = items.filter((i) => i.relevance === "medium").length;
  const lowCount = items.filter((i) => i.relevance === "low").length;

  return {
    period_start: periodStart,
    period_end: periodEnd,
    signal_count: signalCount,
    item_count: items.length,
    high_count: highCount,
    medium_count: mediumCount,
    low_count: lowCount,
    categories
  };
}

// ---------------------------------------------------------------------------
// buildContentMarkdown
// ---------------------------------------------------------------------------

/**
 * Build a Markdown-formatted brief for human consumption.
 *
 * Format:
 *   # SecureLogic AI — Intelligence Brief
 *   **Period:** start → end
 *   **Signals processed:** N | **High relevance:** N | **Medium:** N | **Low:** N
 *
 *   ## Category Label
 *   ### [HIGH] Title
 *   Summary text.
 *   CVE: ... | Vendor: ... | Source: ...
 *   ...
 */
export function buildContentMarkdown(content: BriefContentJson): string {
  const lines: string[] = [];

  lines.push("# SecureLogic AI — Intelligence Brief");
  lines.push("");
  lines.push(
    `**Period:** ${content.period_start} → ${content.period_end}`
  );
  lines.push(
    `**Signals processed:** ${content.signal_count} | ` +
    `**High relevance:** ${content.high_count} | ` +
    `**Medium:** ${content.medium_count} | ` +
    `**Low:** ${content.low_count}`
  );

  for (const group of content.categories) {
    lines.push("");
    lines.push(`## ${group.label}`);

    for (const item of group.items) {
      lines.push("");
      const badge = item.relevance.toUpperCase();
      lines.push(`### [${badge}] ${item.title}`);
      if (item.summary && item.summary !== item.title) {
        lines.push("");
        lines.push(item.summary);
      }

      const meta: string[] = [];
      if (item.affected_cve) meta.push(`CVE: ${item.affected_cve}`);
      if (item.affected_vendor) meta.push(`Vendor: ${item.affected_vendor}`);
      meta.push(`Source: ${item.source_slug}`);
      meta.push(`Severity: ${item.severity}`);

      lines.push("");
      lines.push(meta.join(" | "));
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// enrichBriefItems  (I/O — calls Claude API)
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-sonnet-4-6";

const CLAUDE_SYSTEM_PROMPT =
  "You are a senior cybersecurity analyst writing for a weekly executive intelligence briefing " +
  "read by CISOs, risk officers, GRC leads, and security engineers at mid-to-large enterprises. " +
  "Your analysis must be specific, technical where appropriate, and commercially grounded. " +
  "Never use generic boilerplate like 'this reflects active malicious tradecraft'. " +
  "Always reference the specific technology, vendor, regulation, or threat actor involved. " +
  "Every analysis must explain the mechanism — how the attack works, what the attacker gains, " +
  "or what the regulatory change requires. Business impact must name who is affected and what breaks. " +
  "Recommended actions must be concrete steps a team can execute this week, not policy reminders.";

/**
 * Derive fallback why_it_matters text when Claude enrichment fails.
 * Ensures every item has non-empty content even without API access.
 *
 * Constrained to the same shape the Claude prompt produces: ≤2 sentences,
 * consequence-first, no throat-clearing.
 */
function fallbackWhyItMatters(item: BriefItem): string {
  const vendor = item.affected_vendor ? `${item.affected_vendor} ` : "";
  const cve = item.affected_cve ? ` (${item.affected_cve})` : "";
  return (
    `${vendor}environments${cve} face active exploitation risk at ${item.severity.toLowerCase()} severity. ` +
    `Unpatched systems are exposed until remediation is verified.`
  );
}

/**
 * Derive fallback recommended_actions text when Claude enrichment fails.
 *
 * Item 1 follows the prompt's tight format (owner: verb object by deadline)
 * so the frontend's first-line render still produces a usable action card.
 */
function fallbackRecommendedActions(item: BriefItem): string {
  const target = item.affected_cve ?? item.affected_vendor ?? "affected systems";
  const lines: string[] = [
    `1. Security: patch ${target} on internet-facing assets within this week.`
  ];
  if (item.affected_cve) {
    lines.push(`2. Review the vendor advisory for ${item.affected_cve} and apply available patches.`);
  } else {
    lines.push("2. Review the vendor advisory and apply available mitigations.");
  }
  lines.push(
    "3. Monitor endpoint and network telemetry for indicators of compromise.",
    "4. Validate firewall and access control rules for affected services.",
    "5. Escalate to incident response if active exploitation is suspected."
  );
  return lines.join("\n");
}

/**
 * Default urgency band when enrichment cannot classify (API key missing,
 * call failure, parse failure, LLM returned a string outside the rubric).
 *
 * 'near_term' is the conservative middle: more urgent than monitor-only,
 * less urgent than drop-everything-this-week. Treats an unknown item as
 * "act this month" rather than under- or over-prioritising it.
 */
const URGENCY_FALLBACK: BriefUrgency = "near_term";

const URGENCY_VALUES: ReadonlyArray<BriefUrgency> = [
  "immediate",
  "near_term",
  "far_term"
];

function isBriefUrgency(value: unknown): value is BriefUrgency {
  return typeof value === "string" && (URGENCY_VALUES as readonly string[]).includes(value);
}

/**
 * Call the Claude API to enrich a single brief item with analyst commentary.
 *
 * I/O: makes one HTTP request to the Anthropic API.
 * Returns the enriched item. On any failure (network error, non-200, JSON
 * parse error, missing fields), returns the item with fallback content so
 * brief generation never fails due to enrichment errors.
 *
 * Requires ANTHROPIC_API_KEY in the environment. If the key is absent,
 * fallback content is returned immediately without making any API call.
 */
// A08-G4: this enrichment text flows into a paid, customer-facing Intelligence
// Brief. A prompt-injected or malformed Claude response must not reach the
// brief. Unlike the assessment-analyzer path there is no severity enum to
// forge and the function contract is Promise<BriefItem> (never null), so a
// schema failure routes into the SAME fallback BriefItem the catch already
// produces — not a rejection. All fields are optional+length-capped: the
// per-field typeof/fallback logic below still applies to a well-typed
// response; the schema's job is to reject structurally-broken or oversize
// (bloat-injection) payloads before that logic runs.
const EnrichmentResponseSchema = z.object({
  analysis: z.string().max(20000).optional(),
  why_it_matters: z.string().max(20000).optional(),
  recommended_actions: z.string().max(20000).optional(),
  urgency: z.string().max(50).optional()
});

async function enrichItemWithClaude(
  item: BriefItem,
  organizationId: string | null = null
): Promise<BriefItem> {
  const client = getClient();
  if (!client) {
    logger.warn(
      { event: "brief_enrichment_fallback", reason: "ANTHROPIC_API_KEY not set", signal_id: item.cyber_signal_id, organizationId },
      "Brief enrichment falling back to defaults"
    );
    return {
      ...item,
      analysis: null,
      why_it_matters: fallbackWhyItMatters(item),
      recommended_actions: fallbackRecommendedActions(item),
      analyst_notes: null,
      urgency: URGENCY_FALLBACK
    };
  }

  logger.info(
    {
      event: "llm_call_start",
      purpose: "brief_item_enrichment",
      model: "claude-haiku-4-5",
      organizationId,
      signal_id: item.cyber_signal_id
    },
    "LLM call: brief item enrichment"
  );

  const vendorLine = item.affected_vendor ? `Vendor/Product: ${item.affected_vendor}\n` : "";
  const cveLine = item.affected_cve ? `CVE: ${item.affected_cve}\n` : "";

  // Signal-type-specific analysis guidance — preserved from the prior prompt
  // because each signal type has different stakes (CVE attack vectors vs.
  // regulatory deadlines vs. breach scope).
  const analysisGuidance = (() => {
    if (item.affected_cve) {
      return `Explain the vulnerability in ${item.affected_vendor ?? "the affected product"}, the attack vector (remote/local, auth required, exploit complexity), and what an attacker can achieve post-exploitation.`;
    }
    if (item.signal_type === "threat_actor" || item.signal_type === "malware") {
      return "Describe the threat actor's TTPs, the targeted sectors or systems, and the kill chain stage this represents.";
    }
    if (item.signal_type === "regulatory_change") {
      return "Explain what the regulation or guidance requires, which teams or systems it applies to, and the compliance deadline or enforcement trigger.";
    }
    if (item.signal_type === "breach" || item.signal_type === "third_party_breach") {
      return "Describe the breach scope, what data or systems were compromised, and the third-party exposure risk for downstream customers.";
    }
    return "Be specific to the signal — name the technology, vendor, or actor involved.";
  })();

  const userPrompt =
    `Signal: ${item.summary}\n` +
    vendorLine +
    cveLine +
    `Severity: ${item.severity}\n` +
    `Signal type: ${item.signal_type}\n` +
    `Category: ${item.category}\n\n` +
    `Return JSON only with exactly four fields: analysis, why_it_matters, recommended_actions, urgency.\n\n` +

    `- analysis: 3-4 sentences. Must be specific to this signal type (${item.signal_type}). ` +
    `${analysisGuidance} ` +
    `Do not use generic phrases like 'reflects active malicious tradecraft'. Reference the specific ` +
    `technology, regulation, or actor by name.\n\n` +

    `- why_it_matters: HARD LIMIT 40 words across at most 2 sentences. ` +
    `Lead with the consequence — what breaks, what liability arises, who is exposed. ` +
    `No throat-clearing, no "this is important because", no setup. ` +
    `Reference compliance frameworks (HIPAA, SOC 2, NIST, EU AI Act) only if directly triggered.\n\n` +

    `- recommended_actions: a plain newline-numbered list of 3-5 concrete actions, ` +
    `format "1. [action]\\n2. [action]\\n...". No markdown, no sub-bullets.\n` +
    `  ITEM 1 IS CONSTRAINED: max 25 words, single imperative sentence, ` +
    `format "Owner: verb object by deadline." ` +
    `Examples: ` +
    `"Security: patch CVE-2026-41940 on internet-facing cPanel by Friday." ` +
    `"Compliance: file initial breach notification with HHS within 60 days." ` +
    `Owner must be a function (Security, Compliance, Procurement, Legal, IT, ` +
    `DevSecOps, SOC, Cloud Platform). Verb must be specific (patch, file, audit, ` +
    `block, rotate, contact) — not "review" or "consider".\n` +
    `  Items 2-5 are unconstrained — longer detailed actions are fine here.\n\n` +

    `- urgency: a single string, one of "immediate" | "near_term" | "far_term". ` +
    `Classify using this rubric:\n` +
    `    immediate — act this week. KEV-listed, active exploitation confirmed, ` +
    `federal remediation deadline triggered, or CVSS 9+ with public PoC and the ` +
    `vendor is plausibly in the org's environment.\n` +
    `    near_term — act this month. Critical/high-severity vulnerabilities with ` +
    `patches available, exploitation likely but not yet confirmed, regulatory ` +
    `guidance with stated near-term compliance dates.\n` +
    `    far_term  — monitor. Emerging threat patterns, advisory-only items, ` +
    `vendor announcements without confirmed exploitation, longer-horizon ` +
    `regulatory shifts.\n` +
    `  Choose exactly one. Do not invent other values.`;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: CLAUDE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    // Strip markdown code fences if Claude wrapped the JSON
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    const fallbackItem: BriefItem = {
      ...item,
      analysis: null,
      why_it_matters: fallbackWhyItMatters(item),
      recommended_actions: fallbackRecommendedActions(item),
      analyst_notes: null,
      urgency: URGENCY_FALLBACK
    };

    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(cleaned);
    } catch {
      logger.warn(
        {
          event: "brief_enrichment_invalid_json",
          signal_id: item.cyber_signal_id,
          organizationId
        },
        "Brief enrichment: response did not JSON-parse — using fallback (A08-G4)"
      );
      return fallbackItem;
    }

    const validated = EnrichmentResponseSchema.safeParse(parsedUnknown);
    if (!validated.success) {
      logger.warn(
        {
          event: "brief_enrichment_invalid_shape",
          signal_id: item.cyber_signal_id,
          organizationId,
          issues: validated.error.issues.slice(0, 10)
        },
        "Brief enrichment: response failed schema validation — using fallback (A08-G4)"
      );
      return fallbackItem;
    }

    const parsed = validated.data;

    const analysis =
      typeof parsed.analysis === "string" && parsed.analysis.trim().length > 0
        ? parsed.analysis.trim()
        : null;

    const whyItMatters =
      typeof parsed.why_it_matters === "string" && parsed.why_it_matters.trim().length > 0
        ? parsed.why_it_matters.trim()
        : fallbackWhyItMatters(item);

    const recommendedActions =
      typeof parsed.recommended_actions === "string" && parsed.recommended_actions.trim().length > 0
        ? parsed.recommended_actions.trim()
        : fallbackRecommendedActions(item);

    const urgency: BriefUrgency = isBriefUrgency(parsed.urgency)
      ? parsed.urgency
      : URGENCY_FALLBACK;

    return {
      ...item,
      analysis,
      why_it_matters: whyItMatters,
      recommended_actions: recommendedActions,
      analyst_notes: null,
      urgency
    };
  } catch (err) {
    logger.warn(
      { event: "brief_enrichment_fallback", reason: "Exception during enrichment", signal_id: item.cyber_signal_id, organizationId, err },
      "Brief enrichment falling back to defaults"
    );
    return {
      ...item,
      analysis: null,
      why_it_matters: fallbackWhyItMatters(item),
      recommended_actions: fallbackRecommendedActions(item),
      analyst_notes: null,
      urgency: URGENCY_FALLBACK
    };
  }
}

/**
 * Enrich an array of brief items with analyst commentary from Claude.
 *
 * I/O: calls Claude API once per item using Promise.all (concurrent).
 * All failures are caught per-item — the batch always resolves fully.
 * Callers can proceed to DB insertion regardless of enrichment outcome.
 *
 * @param items  Items produced by buildBriefItems().
 * @returns      Same items with why_it_matters and recommended_actions populated.
 */
export async function enrichBriefItems(
  items: ReadonlyArray<BriefItem>,
  organizationId: string | null = null
): Promise<BriefItem[]> {
  return Promise.all(items.map((item) => enrichItemWithClaude(item, organizationId)));
}

// ---------------------------------------------------------------------------
// generateBrief  (pre-enrichment, pure)
// ---------------------------------------------------------------------------

/**
 * Pre-enrichment stage of brief generation. Pure; preserves the
 * "no I/O in generator.ts" invariant (line 4).
 *
 * Pipeline:
 *   1. buildBriefItems(signals)         — map + CVE-merge + sort
 *   2. shortlistTopK(items, ENRICHMENT_SHORTLIST) — top-K by composite key
 *
 * The shortlist is what the scheduler hands to enrichBriefItems(). After
 * enrichment, the scheduler calls capByUrgencyBuckets() then
 * finalizeBrief() to produce the persisted content.
 *
 * signal_count is the raw cyber_signals input count (NOT the shortlist
 * size or the eventual capped count) — this is what gets stored on
 * intelligence_briefs.signal_count for "we processed N signals to
 * produce this brief" reporting.
 */
export function generateBrief(
  signals: ReadonlyArray<CyberSignalForBrief>
): {
  shortlist: BriefItem[];
  signal_count: number;
} {
  const items = buildBriefItems(signals);
  const shortlist = shortlistTopK(items, ENRICHMENT_SHORTLIST);

  return {
    shortlist,
    signal_count: signals.length
  };
}

// ---------------------------------------------------------------------------
// finalizeBrief  (post-enrichment, post-cap, pure)
// ---------------------------------------------------------------------------

/**
 * Post-enrichment stage. Caller has already run enrichBriefItems() on the
 * shortlist and capByUrgencyBuckets() on the enriched output. This packages
 * the capped items into the persisted content shapes.
 *
 * Pure; takes signal_count from the original generateBrief() return so the
 * persisted intelligence_briefs.signal_count reflects the raw input, not
 * the post-cap count.
 */
export function finalizeBrief(
  cappedItems: ReadonlyArray<BriefItem>,
  periodStart: string,
  periodEnd: string,
  signalCount: number
): {
  items: BriefItem[];
  content_json: BriefContentJson;
  content_markdown: string;
  signal_count: number;
  item_count: number;
} {
  const content_json = buildContentJson(
    cappedItems,
    periodStart,
    periodEnd,
    signalCount
  );
  const content_markdown = buildContentMarkdown(content_json);

  return {
    items: [...cappedItems],
    content_json,
    content_markdown,
    signal_count: signalCount,
    item_count: cappedItems.length
  };
}
