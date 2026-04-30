/**
 * briefSynthesizer.ts — Brief-level synthesis (top-of-brief intelligence).
 *
 * Produces the executive front-page content the spec mandates: a 2-3
 * sentence editorial opening, a one-sentence thesis headline, optional
 * cross-domain pattern detection, and a structured action summary
 * (this week / this month / monitor).
 *
 * Architecturally separate from intelligenceBriefGenerator.ts. The latter
 * runs item-level enrichment (one Claude call per item). This module runs
 * brief-level synthesis (4 Claude calls per brief, aggregating across all
 * items). Different scope, different prompts, different output shapes.
 *
 * Prompts ported verbatim from the legacy worker
 * (services/intelligence-worker/src/pipeline/llmClient.ts) where they
 * were tuned against the spec's banned-phrases list and weak-vs-premium
 * examples in docs/intelligence-brief-spec.md. Do not modify the prompt
 * language casually — they're load-bearing.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../infra/logger.js";
import type { BriefItem } from "./intelligenceBriefGenerator.js";

const CLAUDE_MODEL = "claude-sonnet-4-6";

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefSynthesisActionSummary = {
  this_week: string[];
  this_month: string[];
  monitor: string[];
};

export type BriefSynthesis = {
  thesis: string | null;
  executive_summary: string | null;
  cross_domain_analysis: string | null;
  action_summary: BriefSynthesisActionSummary | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick the best available analysis text for a BriefItem.
 *
 * Items just produced by buildBriefItems + enrichBriefItems carry `analysis`
 * (Claude-generated). Items loaded from intelligence_brief_items in the DB
 * do NOT carry analysis (column not persisted) but do carry why_it_matters.
 * Both fall back to summary when neither is available.
 */
function analysisTextFor(item: BriefItem): string {
  return item.analysis ?? item.why_it_matters ?? item.summary ?? "";
}

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("")
    .trim();
}

// ---------------------------------------------------------------------------
// repairTruncatedJson — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Best-effort repair of a possibly-truncated JSON string emitted by Claude
 * when max_tokens cuts the response mid-token.
 *
 * If the input is already valid JSON, returns it unchanged. Otherwise:
 * counts unclosed brackets/braces and appends matching closers, after
 * trimming any trailing partial-string token. The output is not guaranteed
 * to parse — callers should still wrap JSON.parse in a try.
 *
 * Repair logic mirrors the legacy worker's action-summary in-line repair
 * (services/intelligence-worker/src/pipeline/llmClient.ts), wrapped here
 * with a try-parse guard so the helper is safe to call on any input. The
 * trailing-string regex was tuned for the realistic Claude truncation
 * pattern (mid-token cut); already-closed strings followed by missing
 * structural closers may not repair cleanly.
 */
export function repairTruncatedJson(input: string): string {
  try {
    JSON.parse(input);
    return input;
  } catch {
    // fall through to repair
  }

  let repaired = input;
  const openBraces =
    (repaired.match(/\{/g) ?? []).length - (repaired.match(/\}/g) ?? []).length;
  const openBrackets =
    (repaired.match(/\[/g) ?? []).length - (repaired.match(/\]/g) ?? []).length;
  // Trim trailing incomplete string/token before closing
  repaired = repaired.replace(/,?\s*"[^"]*$/, "").replace(/,\s*$/, "");
  repaired +=
    "]".repeat(Math.max(0, openBrackets)) + "}".repeat(Math.max(0, openBraces));
  return repaired;
}

// ---------------------------------------------------------------------------
// 1. synthesizeBrief — 2-3 sentence executive opening
// ---------------------------------------------------------------------------

async function synthesizeBrief(
  items: BriefItem[],
  activeCategories: string[],
  totalCount: number
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (items.length === 0) return null;

  const topItems = items.slice(0, 5);
  const signalLines = topItems
    .map((it, i) => `${i + 1}. [${it.severity.toUpperCase()}] ${it.title}`)
    .join("\n");

  const prompt = `You are the editor of a premium enterprise risk intelligence brief read by CISOs, risk leaders, and compliance teams at large organizations.

This week's brief covers ${totalCount} signals across: ${activeCategories.join(", ")}.

Top priority signals this week:
${signalLines}

Write the "Intelligence Synthesis" — a 2-3 sentence editorial opening for this week's brief. Requirements:
- Sentence 1: Name the dominant risk theme or pattern this week. Be specific — name the actual threat, regulation, or event driving the theme.
- Sentence 2: Name the single most time-sensitive development and why it is urgent right now (not next month).
- Sentence 3 (if a cross-domain pattern exists): Identify where signals from different categories point at the same underlying enterprise risk.
- Write with editorial authority — make a clear argument about what matters, not a summary of what exists
- Do not use the phrase "this week's signals" as your opening
- Do not reference yourself or the brief format

This text will be the first thing a CISO reads. It must earn their attention in the first sentence.

Return plain text only.`;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }]
    });
    const text = extractText(message);
    return text || null;
  } catch (err) {
    logger.warn(
      { event: "synthesis_brief_failed", err },
      "Brief synthesis call failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. generateThesisHeadline — single declarative sentence
// ---------------------------------------------------------------------------

async function generateThesisHeadline(
  synthesis: string,
  items: BriefItem[]
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const signalLines = items
    .slice(0, 3)
    .map((it) => `[${it.severity.toUpperCase()}] ${it.title}`)
    .join("\n");

  const prompt = `Write a single-sentence thesis headline for this week's intelligence brief. It should capture the dominant risk theme as a declarative statement — not a title, not a question.

Synthesis: ${synthesis}

Top signals:
${signalLines}

Example good headlines:
- "AI governance liability collides with active exploit exposure in a high-pressure week for enterprise risk teams."
- "Regulatory enforcement timelines compress as three simultaneous compliance deadlines converge on the same enterprise functions."

Return plain text only. One sentence. No trailing period needed.`;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }]
    });
    const text = extractText(message).replace(/\.$/, "");
    return text || null;
  } catch (err) {
    logger.warn(
      { event: "synthesis_thesis_failed", err },
      "Thesis headline generation failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. generateCrossDomainAnalysis — pattern across categories
// ---------------------------------------------------------------------------

async function generateCrossDomainAnalysis(
  items: BriefItem[]
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  // Need signals from at least 2 different categories
  const categories = new Set(items.map((it) => it.category));
  if (categories.size < 2) return null;

  const signalLines = items
    .slice(0, 10)
    .map((it) => {
      const cat = it.category.toUpperCase();
      const sev = it.severity.toUpperCase();
      const analysis = analysisTextFor(it).slice(0, 150);
      return `[${cat} / ${sev}] ${it.title}: ${analysis}`;
    })
    .join("\n");

  const prompt = `You are a senior risk intelligence analyst writing for enterprise security and compliance leaders.

Review these signals from this week's brief and identify the most significant pattern that connects signals across different risk categories. Not every brief will have one — only write this if a genuine connection exists.

This week's signals:
${signalLines}

If a meaningful cross-domain pattern exists: write 1-2 paragraphs that:
- Name the specific signals involved (use their actual titles)
- Explain the connecting risk thread in concrete terms
- State what this means for an enterprise — what single work item or risk conversation this creates
- Do NOT write generic observations like "signals this week span multiple domains"

If no meaningful cross-domain pattern exists, return exactly: NO_PATTERN

Return plain text only.`;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }]
    });
    const text = extractText(message);
    if (!text || text === "NO_PATTERN") return null;
    return text;
  } catch (err) {
    logger.warn(
      { event: "synthesis_cross_domain_failed", err },
      "Cross-domain analysis generation failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. generateActionSummary — JSON { this_week, this_month, monitor }
// ---------------------------------------------------------------------------

async function generateActionSummary(
  items: BriefItem[]
): Promise<BriefSynthesisActionSummary | null> {
  const client = getClient();
  if (!client) return null;
  if (items.length === 0) return null;

  const signalLines = items
    .slice(0, 12)
    .map((it) => {
      const cat = it.category.toUpperCase();
      const sev = it.severity.toUpperCase();
      const analysis = analysisTextFor(it).slice(0, 200);
      return `[${cat} / ${sev}] ${it.title}: ${analysis}`;
    })
    .join("\n");

  const prompt = `You are a risk intelligence analyst creating an action summary for a CISO. This is the section they will hand to their team on Monday morning.

From the signals below, extract the most important actions into three lists. Each action must:
- Name a responsible function (security team, compliance team, procurement, legal, IT)
- Name a specific task (not "review your controls" — a concrete action)
- Be derived from a specific signal, not a general best practice

Signals this week:
${signalLines}

Return valid JSON only — no markdown, no code fences:
{
  "thisWeek": [
    "Security team: [specific action tied to a specific signal, within 72 hours]",
    "Compliance team: [specific action, within this week]"
  ],
  "thisMonth": [
    "Procurement: [specific action from a vendor risk or regulatory signal]",
    "Security team: [specific medium-term action]"
  ],
  "monitor": [
    "[Specific development to watch — what signal, what to watch for, timeframe]",
    "[Another monitoring item]"
  ]
}

Include 2-3 items per list. Omit a list item if there is no specific signal to support it.`;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });

    const raw = extractText(message);
    const cleaned = raw
      .replace(/^```(?:json)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();

    let parsed: { thisWeek?: unknown; thisMonth?: unknown; monitor?: unknown };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const repaired = repairTruncatedJson(cleaned);
      logger.warn(
        {
          event: "synthesis_action_summary_json_repaired",
          originalLength: cleaned.length,
          repairedLength: repaired.length
        },
        "Action summary JSON was truncated — attempted repair"
      );
      parsed = JSON.parse(repaired);
    }

    const thisWeek = Array.isArray(parsed.thisWeek) ? (parsed.thisWeek as string[]) : [];
    const thisMonth = Array.isArray(parsed.thisMonth) ? (parsed.thisMonth as string[]) : [];
    const monitor = Array.isArray(parsed.monitor) ? (parsed.monitor as string[]) : [];

    if (thisWeek.length === 0 && thisMonth.length === 0 && monitor.length === 0) {
      return null;
    }

    return {
      this_week: thisWeek,
      this_month: thisMonth,
      monitor
    };
  } catch (err) {
    logger.warn(
      { event: "synthesis_action_summary_failed", err },
      "Action summary generation failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full brief-level synthesis pipeline.
 *
 * Sequencing:
 *   1. synthesizeBrief — produces editorial 2-3 sentence opening.
 *   2. generateThesisHeadline — depends on the synthesis output above.
 *   3. generateCrossDomainAnalysis + generateActionSummary — independent of
 *      thesis/synthesis, run in parallel.
 *
 * Total: 4 Claude calls per brief (2 sequential at the start, then 2 in
 * parallel). Each call is non-fatal: on failure the corresponding field
 * lands as null and the rest of the synthesis still returns.
 *
 * Throws on empty items[] — synthesis with zero signals has no meaning.
 *
 * @param items             Items in the brief, pre-sorted by sort_order.
 * @param _periodStart      ISO-8601 — currently unused. Reserved for future
 *                          prompts that mention the coverage window.
 * @param _periodEnd        ISO-8601 — same.
 * @param activeCategories  Distinct category labels present in the items.
 */
export async function enrichBriefSynthesis(
  items: BriefItem[],
  _periodStart: string,
  _periodEnd: string,
  activeCategories: string[]
): Promise<BriefSynthesis> {
  if (items.length === 0) {
    throw new Error("enrichBriefSynthesis: items[] must be non-empty");
  }

  const executive_summary = await synthesizeBrief(
    items,
    activeCategories,
    items.length
  );

  const thesis = executive_summary
    ? await generateThesisHeadline(executive_summary, items)
    : null;

  const [cross_domain_analysis, action_summary] = await Promise.all([
    generateCrossDomainAnalysis(items),
    generateActionSummary(items)
  ]);

  return {
    thesis,
    executive_summary,
    cross_domain_analysis,
    action_summary
  };
}
