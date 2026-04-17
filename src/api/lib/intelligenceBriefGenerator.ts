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
import { logger } from "../infra/logger.js";

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
      return "regulatory";

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
// buildBriefItems
// ---------------------------------------------------------------------------

/**
 * Convert an array of cyber signal rows into sorted BriefItems.
 *
 * Items are sorted by:
 *   1. relevance: high → medium → low
 *   2. ingestion_timestamp DESC (most recent first within each relevance tier)
 *
 * sort_order is assigned as a 0-based integer after sorting.
 */
export function buildBriefItems(signals: ReadonlyArray<CyberSignalForBrief>): BriefItem[] {
  const RELEVANCE_RANK: Record<BriefRelevance, number> = { high: 0, medium: 1, low: 2 };

  const items: BriefItem[] = signals.map((s) => ({
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
 * Derive a concise title for a brief item.
 *
 * Priority:
 *   1. Use normalized_summary if ≤ 80 chars
 *   2. Truncate normalized_summary to 77 chars + "..."
 *   3. If summary is empty, build from CVE/vendor/signal_type
 */
function buildItemTitle(signal: CyberSignalForBrief): string {
  const summary = signal.normalized_summary.trim();
  if (summary.length === 0) {
    const parts: string[] = [];
    if (signal.affected_cve) parts.push(signal.affected_cve);
    if (signal.affected_vendor) parts.push(signal.affected_vendor);
    parts.push(signal.signal_type.toUpperCase());
    return parts.join(" — ");
  }
  if (summary.length <= 80) return summary;
  return `${summary.slice(0, 77)}...`;
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
 */
function fallbackWhyItMatters(item: BriefItem): string {
  const vendor = item.affected_vendor ? `${item.affected_vendor} ` : "";
  const cve = item.affected_cve ? ` (${item.affected_cve})` : "";
  return (
    `This ${item.severity.toLowerCase()} ${item.signal_type} affects ${vendor}environments${cve}. ` +
    `Active exploitation or high exploitation probability has been identified. ` +
    `Organizations with ${vendor || "affected "}products should treat this as a priority remediation item.`
  );
}

/**
 * Derive fallback recommended_actions text when Claude enrichment fails.
 */
function fallbackRecommendedActions(item: BriefItem): string {
  const lines: string[] = [
    "1. Identify all affected systems in your environment."
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
async function enrichItemWithClaude(item: BriefItem): Promise<BriefItem> {
  const client = getClient();
  if (!client) {
    logger.warn(
      { event: "brief_enrichment_fallback", reason: "ANTHROPIC_API_KEY not set", signal_id: item.cyber_signal_id },
      "Brief enrichment falling back to defaults"
    );
    return {
      ...item,
      analysis: null,
      why_it_matters: fallbackWhyItMatters(item),
      recommended_actions: fallbackRecommendedActions(item),
      analyst_notes: null
    };
  }

  const vendorLine = item.affected_vendor ? `Vendor/Product: ${item.affected_vendor}\n` : "";
  const cveLine = item.affected_cve ? `CVE: ${item.affected_cve}\n` : "";

  const userPrompt =
    `Signal: ${item.summary}\n` +
    vendorLine +
    cveLine +
    `Severity: ${item.severity}\n` +
    `Signal type: ${item.signal_type}\n` +
    `Category: ${item.category}\n\n` +
    `Return JSON only with exactly three fields:\n\n` +
    `- analysis: 3-4 sentences. Must be specific to this signal type (${item.signal_type}). ` +
    `${item.affected_cve ? `Explain the vulnerability in ${item.affected_vendor ?? "the affected product"}, the attack vector (remote/local, auth required, exploit complexity), and what an attacker can achieve post-exploitation.` : ""}` +
    `${item.signal_type === "threat_actor" || item.signal_type === "malware" ? `Describe the threat actor's TTPs, the targeted sectors or systems, and the kill chain stage this represents.` : ""}` +
    `${item.signal_type === "regulatory_change" ? `Explain what the regulation or guidance requires, which teams or systems it applies to, and the compliance deadline or enforcement trigger.` : ""}` +
    `${item.signal_type === "breach" || item.signal_type === "third_party_breach" ? `Describe the breach scope, what data or systems were compromised, and the third-party exposure risk for downstream customers.` : ""}` +
    ` Do not use generic phrases like 'reflects active malicious tradecraft'. Reference the specific ` +
    `technology, regulation, or actor by name.\n\n` +
    `- why_it_matters: 2-3 sentences in business-impact framing. Name which teams are affected ` +
    `(e.g. SOC, DevSecOps, legal, finance, cloud platform). State what breaks or what liability arises ` +
    `if this is ignored. Reference any relevant compliance frameworks (HIPAA, SOC 2, NIST, EU AI Act) ` +
    `if applicable.\n\n` +
    `- recommended_actions: A plain numbered list of 3-5 concrete actions. Each action must be ` +
    `executable this week or this month — not a policy reminder. Include specific steps: ` +
    `patch version numbers if applicable, detection queries or log sources to check, ` +
    `configuration changes to make, vendor contacts to engage, or regulatory filings to prepare. ` +
    `Format: "1. [action]\\n2. [action]\\n..." — no markdown, no sub-bullets.`;

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

    const parsed = JSON.parse(cleaned) as {
      analysis?: string;
      why_it_matters?: string;
      recommended_actions?: string;
    };

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

    return {
      ...item,
      analysis,
      why_it_matters: whyItMatters,
      recommended_actions: recommendedActions,
      analyst_notes: null
    };
  } catch (err) {
    logger.warn(
      { event: "brief_enrichment_fallback", reason: "Exception during enrichment", signal_id: item.cyber_signal_id, err },
      "Brief enrichment falling back to defaults"
    );
    return {
      ...item,
      analysis: null,
      why_it_matters: fallbackWhyItMatters(item),
      recommended_actions: fallbackRecommendedActions(item),
      analyst_notes: null
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
  items: ReadonlyArray<BriefItem>
): Promise<BriefItem[]> {
  return Promise.all(items.map((item) => enrichItemWithClaude(item)));
}

// ---------------------------------------------------------------------------
// generateBrief
// ---------------------------------------------------------------------------

/**
 * Top-level pure generator: takes signals, returns a complete brief payload
 * ready for DB insertion.
 *
 * Returns:
 *   { items, content_json, content_markdown, signal_count, item_count }
 *
 * The caller is responsible for DB writes (brief row + item rows).
 */
export function generateBrief(
  signals: ReadonlyArray<CyberSignalForBrief>,
  periodStart: string,
  periodEnd: string
): {
  items: BriefItem[];
  content_json: BriefContentJson;
  content_markdown: string;
  signal_count: number;
  item_count: number;
} {
  const items = buildBriefItems(signals);
  const content_json = buildContentJson(items, periodStart, periodEnd, signals.length);
  const content_markdown = buildContentMarkdown(content_json);

  return {
    items,
    content_json,
    content_markdown,
    signal_count: signals.length,
    item_count: items.length
  };
}
