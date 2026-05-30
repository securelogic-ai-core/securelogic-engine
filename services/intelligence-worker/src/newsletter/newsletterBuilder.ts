import { getInsights } from "../storage/postgresInsightStore.js";
import { pgElevated } from "../../../../src/api/infra/postgres.js";
import { logger } from "../../../../src/api/infra/logger.js";
import {
  analyzeSignal,
  synthesizeBrief,
  generateThesisHeadline,
  generateCrossDomainAnalysis,
  generateActionSummary,
  generateRiskRationale,
  type CrossDomainSignalInput,
  type ActionSummary
} from "../pipeline/llmClient.js";
import { extractCve, extractVendor } from "../pipeline/normalizeSignal.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SIGNALS_PER_BRIEF = 12;
const MAX_SIGNALS_PER_SECTION = 3;

// GENERAL is excluded from published output — signals without a clear category
// are not worth publishing. Every published signal must fit a named domain.
const PUBLISHED_CATEGORIES = [
  "AI_GOVERNANCE",
  "SECURITY_INCIDENT",
  "REGULATION",
  "VENDOR_RISK",
  "COMPLIANCE_UPDATE"
] as const;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function riskRank(level: string) {
  if (level === "critical") return 4;
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function normalizeCategory(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();

  if (!raw) return "GENERAL";
  if (raw.includes("AI")) return "AI_GOVERNANCE";
  if (raw.includes("SECURITY")) return "SECURITY_INCIDENT";
  if (raw.includes("REGULATION")) return "REGULATION";
  if (raw.includes("VENDOR")) return "VENDOR_RISK";
  if (raw.includes("COMPLIANCE")) return "COMPLIANCE_UPDATE";

  return "GENERAL";
}

function dedupeInsights(insights: any[]) {
  const seen = new Map<string, any>();

  for (const insight of insights) {
    const key = insight.signal_id || insight.signalId || insight.id;
    if (!key) continue;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, insight);
      continue;
    }

    const existingRank = riskRank(existing.risk_level || existing.riskLevel || "low");
    const currentRank = riskRank(insight.risk_level || insight.riskLevel || "low");

    if (currentRank >= existingRank) {
      seen.set(key, insight);
    }
  }

  return Array.from(seen.values());
}

function sortByPriority(items: any[]) {
  return items.sort(
    (a, b) =>
      riskRank(b.risk_level || b.riskLevel || "low") -
      riskRank(a.risk_level || a.riskLevel || "low")
  );
}

/**
 * Normalize an insight using only its raw database fields.
 * No template strings. If a field is empty, it remains empty — the LLM
 * enhancement pass will populate it, or the signal will be held.
 *
 * After the insightGenerator change, `insight.analysis` holds the raw source
 * content (not a template). We preserve it as `rawContent` so `applyLLMEnhancement`
 * can pass it directly to the model rather than re-using any prior LLM output.
 */
export function normalizeInsight(insight: any) {
  const normalizedRisk = String(insight.riskLevel || insight.risk_level || "low").toLowerCase();

  // Raw source content — `analysis` is now the floor (raw content passthrough),
  // not a template string. Prefer explicit raw_content if ever added to schema.
  const rawContent = String(
    insight.raw_content || insight.rawContent || insight.analysis || insight.summary || ""
  ).trim();

  const whyItMatters = String(
    insight.risk_implication || insight.riskImplication || insight.executiveImpact || ""
  ).trim();
  const recommendedAction = String(
    insight.recommendation || insight.recommendedAction || ""
  ).trim();

  // Extract CVE/vendor from raw content + title for richer LLM prompts
  const searchText = `${String(insight.title || "").trim()} ${rawContent}`;
  const affectedCve = (insight.affected_cve ?? extractCve(searchText)) as string | null;
  const affectedVendor = (insight.affected_vendor ?? extractVendor(searchText)) as string | null;

  return {
    ...insight,
    category: normalizeCategory(insight.category),
    riskLevel: normalizedRisk,
    risk_level: normalizedRisk,
    signalId: insight.signal_id ?? insight.signalId,
    rawContent,
    summary: rawContent,
    analysis: rawContent,
    affectedCve,
    affectedVendor,
    whyItMatters,
    executiveImpact: whyItMatters,
    riskImplication: whyItMatters,
    risk_implication: whyItMatters,
    recommendedAction,
    recommendation: recommendedAction
  };
}

/**
 * A signal is publishable if it has at minimum:
 * - A non-empty analysis (what happened)
 * - It belongs to a published category (not GENERAL)
 *
 * recommendedAction is not required here — fallback actions are applied
 * upstream in applyLLMEnhancement before this filter runs.
 */
function isPublishable(insight: any): boolean {
  const analysis = String(insight.analysis || "").trim();
  const category = normalizeCategory(insight.category);

  if (!analysis) return false;
  if (!PUBLISHED_CATEGORIES.includes(category as any)) return false;

  return true;
}

function groupByCategory(insights: any[]) {
  const grouped: Record<string, any[]> = {
    AI_GOVERNANCE: [],
    SECURITY_INCIDENT: [],
    REGULATION: [],
    VENDOR_RISK: [],
    COMPLIANCE_UPDATE: []
  };

  for (const insight of insights) {
    const category = normalizeCategory(insight.category);
    if (category in grouped) {
      grouped[category].push({ ...insight, category });
    }
  }

  for (const key of Object.keys(grouped)) {
    grouped[key] = sortByPriority(grouped[key]);
  }

  return grouped;
}

/**
 * Generate a category-appropriate fallback recommendedAction for signals
 * that have no LLM-generated or DB-stored recommendation.
 * Applied when ANTHROPIC_API_KEY is absent or when a per-signal LLM call fails.
 */
function generateFallbackAction(insight: any): string {
  const category = normalizeCategory(insight.category);
  const fallbacks: Record<string, string> = {
    SECURITY_INCIDENT:
      "Review affected systems and apply available patches. Monitor endpoint and network telemetry for indicators of compromise.",
    REGULATION:
      "Review regulatory guidance and assess applicability to your organization's compliance posture.",
    COMPLIANCE_UPDATE:
      "Review regulatory guidance and assess applicability to your organization's compliance posture.",
    VENDOR_RISK:
      "Assess exposure to affected vendors and review contractual security obligations.",
    AI_GOVERNANCE:
      "Review AI governance policies and assess applicability to your organization's AI systems and processes.",
    GENERAL:
      "Monitor developments and assess relevance to your organization's risk profile.",
  };
  return fallbacks[category] ?? fallbacks["GENERAL"]!;
}

/**
 * Apply LLM-generated analysis to a list of normalized insights.
 * Processes in batches of 5 to stay within rate limits.
 *
 * When the API key is absent or a per-signal call fails, a category-appropriate
 * fallback recommendedAction is applied so signals remain publishable.
 */
async function applyLLMEnhancement(insights: any[]): Promise<any[]> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    logger.info(
      { event: "llm_enhancement_skipped" },
      "ANTHROPIC_API_KEY not set — applying fallback actions to signals without recommendations"
    );
    return insights.map((insight) => {
      if (insight.recommendedAction || insight.recommendation) return insight;
      const fallback = generateFallbackAction(insight);
      return { ...insight, recommendedAction: fallback, recommendation: fallback };
    });
  }

  const results = [...insights];
  const BATCH_SIZE = 5;

  for (let batchStart = 0; batchStart < results.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, results.length);
    const batchIndices = Array.from(
      { length: batchEnd - batchStart },
      (_, k) => batchStart + k
    );

    await Promise.all(
      batchIndices.map(async (idx) => {
        const insight = results[idx];
        const llmResult = await analyzeSignal(
          insight.title ?? "",
          insight.rawContent ?? insight.analysis ?? insight.summary ?? "",
          insight.category ?? "GENERAL",
          insight.source ?? "",
          insight.affectedCve ?? null,
          insight.affectedVendor ?? null,
          insight.riskLevel ?? null
        );

        if (llmResult) {
          // LLM succeeded — use LLM output
          results[idx] = {
            ...insight,
            analysis: llmResult.analysis,
            summary: llmResult.analysis,
            whyItMatters: llmResult.whyItMatters,
            recommendedAction: llmResult.recommendedAction,
            recommendation: llmResult.recommendedAction,
            executiveImpact: llmResult.whyItMatters,
            riskImplication: llmResult.whyItMatters,
            risk_implication: llmResult.whyItMatters
          };
        } else {
          // LLM failed — apply fallback if no recommendation exists in raw DB fields
          const existing = insight.recommendedAction || insight.recommendation;
          if (!existing) {
            const fallback = generateFallbackAction(insight);
            results[idx] = { ...insight, recommendedAction: fallback, recommendation: fallback };
          }
        }
      })
    );
  }

  return results;
}

/**
 * Enrich all high and critical signals with a risk rationale explaining
 * why they scored at that level. Applied across all included signals,
 * not just the positional top 3.
 */
export async function enrichSignalsWithRationale(signals: any[]): Promise<any[]> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return signals;

  const enrichedById = new Map<string, any>();

  await Promise.all(
    signals
      .filter((s) => {
        const level = String(s.riskLevel || s.risk_level || "low").toLowerCase();
        return level === "high" || level === "critical";
      })
      .map(async (signal) => {
        const rationale = await generateRiskRationale(
          signal.title ?? "",
          signal.riskLevel ?? "high",
          signal.analysis ?? "",
          signal.category ?? "GENERAL"
        );
        if (rationale) {
          const key = signal.id || signal.signalId || signal.signal_id;
          if (key) enrichedById.set(String(key), { ...signal, riskRationale: rationale });
        }
      })
  );

  return signals.map((s) => {
    const key = String(s.id || s.signalId || s.signal_id || "");
    return enrichedById.get(key) ?? s;
  });
}

/**
 * Map enriched signals back into the section groups so section items
 * reflect updated riskRationale fields without re-sorting.
 */
function applySectionEnrichment(
  sections: Record<string, any[]>,
  enrichedSignals: any[]
): Record<string, any[]> {
  const enrichedById = new Map<string, any>();
  for (const s of enrichedSignals) {
    const key = String(s.id || s.signalId || s.signal_id || "");
    if (key) enrichedById.set(key, s);
  }

  const result: Record<string, any[]> = {};
  for (const [category, items] of Object.entries(sections)) {
    result[category] = items.map((item) => {
      const key = String(item.id || item.signalId || item.signal_id || "");
      return (key && enrichedById.get(key)) ?? item;
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Output projection — canonical BriefItem shape stored in sections_json
// ---------------------------------------------------------------------------

/**
 * Projects an enriched pipeline signal to the canonical BriefItem shape.
 *
 * This is the only function that should write to sections_json.
 * It strips all internal pipeline state (rawContent, DB timestamps,
 * organization_id, etc.) and ensures every required output field is
 * explicitly present with a stable field name.
 *
 * riskLevel is kept as a backward-compat alias so existing app code
 * continues to work without a migration.
 */
export function toBriefItem(item: any): Record<string, unknown> {
  const severity = String(item.riskLevel ?? item.risk_level ?? "low").toLowerCase();
  const recommendation = String(
    item.recommendation ?? item.recommendedAction ?? ""
  ).trim();

  return {
    // Identity
    signalId:      item.signal_id ?? item.signalId ?? null,
    source:        String(item.source ?? "").trim(),
    sourceUrl:     item.url ?? item.source_url ?? null,

    // Classification
    title:         String(item.title ?? "").trim(),
    category:      String(item.category ?? "GENERAL").toUpperCase(),
    severity,
    riskLevel:     severity,      // backward-compat: app currently reads riskLevel

    // Audience
    audience:      String(item.audience ?? "").trim(),

    // Content (LLM-generated from source material, never template strings)
    analysis:      String(item.analysis ?? "").trim(),
    whyItMatters:  String(
      item.whyItMatters ?? item.executiveImpact ?? item.riskImplication ?? ""
    ).trim(),
    recommendation,
    recommendedAction: recommendation,   // backward-compat alias

    // Priority (from executiveWriter pass)
    priorityScore: typeof item.priorityScore === "number" ? item.priorityScore : 0,
    priorityTier:  String(item.priorityTier ?? "MONITOR").trim(),

    // Optional enrichment (all null-safe)
    affectedCve:   item.affectedCve ?? null,
    affectedVendor: item.affectedVendor ?? null,
    riskRationale: item.riskRationale ?? null,
    orgRelevance:  item.orgRelevance ?? null,
  };
}

async function getNextIssueNumber(): Promise<number | null> {
  try {
    const result = await pgElevated.query(
      "SELECT COUNT(*)::int AS total FROM newsletter_issues"
    );
    const count = result.rows[0]?.total ?? 0;
    return (count as number) + 1;
  } catch (err) {
    logger.warn({ event: "issue_number_query_failed", err }, "Could not fetch issue count — omitting number from title");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildNewsletterIssue(organizationId: string | null) {
  const [insights, issueNumber] = await Promise.all([
    getInsights(organizationId, 100),
    getNextIssueNumber()
  ]);

  // 1. Normalize using raw DB fields (no templates)
  const normalized = insights.map((insight: any) => normalizeInsight(insight));

  // 2. Deduplicate
  const deduped = dedupeInsights(normalized);

  // 3. Apply LLM enhancement (falls back to raw DB fields on failure, never templates)
  const enhanced = await applyLLMEnhancement(deduped);

  // 4. Filter to only publishable signals (has analysis, action, and named category)
  const publishable = enhanced.filter(isPublishable);

  logger.info(
    {
      event: "signals_filtered",
      total: enhanced.length,
      publishable: publishable.length,
      held: enhanced.length - publishable.length
    },
    `${publishable.length} of ${enhanced.length} signals are publishable`
  );

  // 5. Group by category, apply per-section caps
  const grouped = groupByCategory(publishable);

  // 6. Apply per-section cap and overall brief cap
  const cappedSections: Record<string, any[]> = {};
  let totalIncluded = 0;

  for (const category of PUBLISHED_CATEGORIES) {
    const available = grouped[category] ?? [];
    const toInclude = available.slice(0, MAX_SIGNALS_PER_SECTION);
    cappedSections[category] = toInclude;
    totalIncluded += toInclude.length;

    if (totalIncluded >= MAX_SIGNALS_PER_BRIEF) break;
  }

  // 7. Enrich all high/critical signals with risk rationale
  const allIncluded = Object.values(cappedSections).flat();
  const enrichedAll = await enrichSignalsWithRationale(allIncluded);

  // 8. Map enriched signals back into section groups and derive top 3
  const enrichedSections = applySectionEnrichment(cappedSections, enrichedAll);
  const topSignals = sortByPriority([...enrichedAll]).slice(0, 3);

  const totalSignalCount = enrichedAll.length;

  // 9. Brief-level synthesis (Sonnet)
  const activeCategories = Object.entries(cappedSections)
    .filter(([, items]) => items.length > 0)
    .map(([cat]) =>
      cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    );

  const topForSynthesis = topSignals.map((i) => ({
    title: i.title ?? "",
    riskLevel: i.riskLevel ?? "low"
  }));

  const executiveSummary = await synthesizeBrief(
    topForSynthesis,
    activeCategories,
    totalSignalCount
  );

  if (!executiveSummary) {
    logger.warn(
      { event: "brief_synthesis_unavailable" },
      "Brief synthesis unavailable — no API key or synthesis failed. Brief will have no executive summary."
    );
  }

  // 10. Thesis headline (Sonnet)
  const thesisHeadline = executiveSummary
    ? await generateThesisHeadline(executiveSummary, topForSynthesis)
    : null;

  // 11. Cross-domain analysis (Sonnet)
  const crossDomainInput: CrossDomainSignalInput[] = allIncluded.map((s) => ({
    title: s.title ?? "",
    category: s.category ?? "GENERAL",
    riskLevel: s.riskLevel ?? "low",
    analysis: s.analysis ?? ""
  }));

  const crossDomainAnalysis = await generateCrossDomainAnalysis(crossDomainInput);

  // 12. Action summary (Sonnet)
  const actionSummary: ActionSummary | null = await generateActionSummary(crossDomainInput);

  // 13. Build title using UTC date in "Weekday, Month Day, Year" format
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
  const title =
    issueNumber != null
      ? `SecureLogic AI Intelligence Brief #${issueNumber} — ${dateLabel}`
      : `SecureLogic AI Intelligence Brief — ${dateLabel}`;

  // Collect IDs of all insights that were included in this brief so the
  // generator can mark them published after a successful createIssue call.
  const includedInsightIds: string[] = allIncluded
    .map((i: any) => i.id)
    .filter(Boolean);

  return {
    id: `NEWS-${Date.now()}`,
    title,
    issueNumber: issueNumber ?? null,
    signalCount: totalSignalCount,
    createdAt: new Date().toISOString(),
    executiveSummary: executiveSummary ?? null,
    thesisHeadline: thesisHeadline ?? null,
    crossDomainAnalysis: crossDomainAnalysis ?? null,
    actionSummary: actionSummary ?? null,
    topSignals,
    includedInsightIds,
    sections: {
      aiGovernance: enrichedSections.AI_GOVERNANCE ?? [],
      securityIncidents: enrichedSections.SECURITY_INCIDENT ?? [],
      regulations: enrichedSections.REGULATION ?? [],
      vendorRisk: enrichedSections.VENDOR_RISK ?? [],
      compliance: enrichedSections.COMPLIANCE_UPDATE ?? []
    }
  };
}
