import { getInsights } from "../storage/postgresInsightStore.js";
import { pg } from "../../../../src/api/infra/postgres.js";
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
 */
function normalizeInsight(insight: any) {
  const normalizedRisk = String(insight.riskLevel || insight.risk_level || "low").toLowerCase();

  // Use raw database fields as the floor — these come from the insight
  // generation pipeline and are real (not template-generated).
  const analysis = String(insight.analysis || insight.summary || "").trim();
  const whyItMatters = String(
    insight.risk_implication || insight.riskImplication || insight.executiveImpact || ""
  ).trim();
  const recommendedAction = String(
    insight.recommendation || insight.recommendedAction || ""
  ).trim();

  return {
    ...insight,
    category: normalizeCategory(insight.category),
    riskLevel: normalizedRisk,
    risk_level: normalizedRisk,
    signalId: insight.signal_id ?? insight.signalId,
    summary: analysis,
    analysis,
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
 * - A non-empty action recommendation
 * - It belongs to a published category (not GENERAL)
 *
 * Signals missing these fields are held from the brief rather than published
 * with template text.
 */
function isPublishable(insight: any): boolean {
  const analysis = String(insight.analysis || "").trim();
  const action = String(insight.recommendedAction || insight.recommendation || "").trim();
  const category = normalizeCategory(insight.category);

  if (!analysis) return false;
  if (!action) return false;
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
 * Apply LLM-generated analysis to a list of normalized insights.
 * Processes in batches of 5 to stay within rate limits.
 *
 * Unlike the previous implementation, LLM failure means the insight retains
 * its raw database fields — NOT template strings.
 */
async function applyLLMEnhancement(insights: any[]): Promise<any[]> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    logger.info(
      { event: "llm_enhancement_skipped" },
      "ANTHROPIC_API_KEY not set — using raw database fields for signal analysis"
    );
    return insights;
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
          insight.analysis ?? insight.summary ?? "",
          insight.category ?? "GENERAL",
          insight.source ?? ""
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
        }
        // LLM failed — raw database fields remain (no template substitution)
      })
    );
  }

  return results;
}

/**
 * Enrich the top 3 signals with risk rationale (why they scored at this level).
 * This is a premium feature that builds trust in the scoring methodology.
 */
async function enrichTopSignalsWithRationale(topSignals: any[]): Promise<any[]> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return topSignals;

  return Promise.all(
    topSignals.map(async (signal) => {
      const rationale = await generateRiskRationale(
        signal.title ?? "",
        signal.riskLevel ?? "high",
        signal.analysis ?? "",
        signal.category ?? "GENERAL"
      );
      return rationale ? { ...signal, riskRationale: rationale } : signal;
    })
  );
}

async function getNextIssueNumber(): Promise<number | null> {
  try {
    const result = await pg.query(
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

  // 7. Top 3 signals (highest priority across all sections)
  const allIncluded = Object.values(cappedSections).flat();
  const topSignalsRaw = sortByPriority([...allIncluded]).slice(0, 3);

  // 8. Enrich top signals with risk rationale
  const topSignals = await enrichTopSignalsWithRationale(topSignalsRaw);

  const totalSignalCount = allIncluded.length;

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

  // 13. Build title
  const weekLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const title =
    issueNumber != null
      ? `SecureLogic AI Intelligence Brief #${issueNumber} — Week of ${weekLabel}`
      : `SecureLogic AI Intelligence Brief — Week of ${weekLabel}`;

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
    sections: {
      aiGovernance: cappedSections.AI_GOVERNANCE ?? [],
      securityIncidents: cappedSections.SECURITY_INCIDENT ?? [],
      regulations: cappedSections.REGULATION ?? [],
      vendorRisk: cappedSections.VENDOR_RISK ?? [],
      compliance: cappedSections.COMPLIANCE_UPDATE ?? []
    }
  };
}
