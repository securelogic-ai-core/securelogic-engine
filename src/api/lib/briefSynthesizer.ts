/**
 * briefSynthesizer.ts — Brief-level synthesis (top-of-brief headline).
 *
 * Produces a single 1-line headline that names the central pattern across
 * the day's signals. Per-signal urgency, action, and context now live on
 * each BriefItem (set by intelligenceBriefGenerator.enrichItemWithClaude),
 * so the brief no longer needs an editorial layer above the items.
 *
 * Architecturally separate from intelligenceBriefGenerator.ts. The latter
 * runs item-level enrichment (one Claude call per item, per-item urgency
 * classified there). This module runs brief-level synthesis (one Claude
 * call total) to produce a 12-word headline.
 *
 * History — this module previously ran four Claude calls per brief
 * (executive summary, thesis headline, cross-domain analysis, action
 * summary). The customer rejected that magazine-shaped output; we
 * collapsed back to the per-item urgency design from earlier briefs and
 * kept only the single headline. The CVE grounding + JSON repair helpers
 * are retained — they have a known imminent caller (per-item enrichment
 * validator, follow-up PR) and are the defense layer against the kind of
 * CVE hallucination documented in PR #25.
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

export type BriefSynthesis = {
  /**
   * 1-line declarative sentence (max 12 words) naming the central pattern
   * across the day's signals. Null when ANTHROPIC_API_KEY is unset, the
   * Claude call fails, or the model returns empty text.
   */
  headline: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("")
    .trim();
}

// ---------------------------------------------------------------------------
// CVE grounding + JSON repair helpers
// ---------------------------------------------------------------------------
//
// Retained for re-use by the per-item enrichment validator (planned in a
// follow-up PR). Do not delete during synthesis collapses — these are the
// defense layer against CVE hallucination.
//
// Earlier briefs produced fabricated CVE identifiers in LLM-generated
// action text (PR #25 documented the incident). The enrichment prompt
// rewrite in this PR tightens recommended_actions[0] to a single
// imperative; once that line starts referencing CVEs by number,
// validateActionGrounding is the planned guard against the same class
// of hallucination at the per-item layer. repairTruncatedJson covers
// max_tokens cuts on any future structured-list output. They have unit
// tests, cost nothing at runtime, and have a known imminent caller.
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
 * The trailing-string regex was tuned for the realistic Claude truncation
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

const CVE_PATTERN = /CVE-\d{4}-\d{4,7}/gi;

/**
 * Build the set of CVE identifiers that appear anywhere in the brief's
 * source items. Used to validate that LLM-generated text only references
 * CVEs that are actually in the input — anything else is a hallucination.
 *
 * Scans every text-bearing field on each item. CVE strings are normalized
 * to uppercase before insertion so lookup is case-insensitive.
 */
export function buildAllowedCveSet(items: BriefItem[]): Set<string> {
  const cves = new Set<string>();
  for (const item of items) {
    const fields: Array<string | null | undefined> = [
      item.affected_cve,
      item.title,
      item.summary,
      item.why_it_matters,
      item.analysis,
      item.recommended_actions ?? null
    ];
    for (const field of fields) {
      if (typeof field !== "string") continue;
      const matches = field.match(CVE_PATTERN);
      if (matches) {
        for (const m of matches) cves.add(m.toUpperCase());
      }
    }
  }
  return cves;
}

export type GroundingResult = {
  kept: string[];
  dropped: Array<{ action: string; offendingCves: string[] }>;
};

/**
 * Filter LLM-generated action strings against an allowed-CVE set.
 *
 * Decision rules:
 * - Zero CVE citations → kept. Vendor/product-only actions are legitimate.
 * - All cited CVEs in the allowed set → kept.
 * - One or more cited CVEs not in the allowed set → dropped entirely.
 *   Mixed grounding is treated as contaminated; partial fabrication poisons
 *   the surrounding claim.
 *
 * Empty or non-string entries are silently skipped.
 */
export function validateActionGrounding(
  actions: string[],
  allowedCves: Set<string>
): GroundingResult {
  const kept: string[] = [];
  const dropped: Array<{ action: string; offendingCves: string[] }> = [];

  for (const action of actions) {
    if (typeof action !== "string" || action.trim().length === 0) {
      continue;
    }

    const cited = action.match(CVE_PATTERN) ?? [];
    if (cited.length === 0) {
      kept.push(action);
      continue;
    }

    const offending = cited.filter(
      (c) => !allowedCves.has(c.toUpperCase())
    );

    if (offending.length === 0) {
      kept.push(action);
    } else {
      dropped.push({ action, offendingCves: offending });
    }
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// generateHeadline — single declarative sentence, max 12 words
// ---------------------------------------------------------------------------

async function generateHeadline(items: BriefItem[]): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (items.length === 0) return null;

  const signalLines = items
    .slice(0, 8)
    .map((it) => `[${it.severity.toUpperCase()}] ${it.title}`)
    .join("\n");

  const prompt = `Write a single-sentence headline for this intelligence brief.

Signals:
${signalLines}

HARD CONSTRAINTS:
- Maximum 12 words.
- Single declarative sentence, present tense.
- Names the central pattern across the day's signals — what ties them together.
- No editorial setup, no questions, no "this week" framing.

Examples of the right shape:
- "Six ABB OT vulnerabilities collide with new federal Zero Trust mandate."
- "Healthcare ransomware wave hits 337K records as Rhysida tooling proliferates."

Counter-examples (too long, embedded clauses, magazine-style — DO NOT do this):
- "AI governance liability collides with active exploit exposure in a high-pressure week for enterprise risk teams."

Return plain text only. One sentence. No trailing period needed.`;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 60,
      messages: [{ role: "user", content: prompt }]
    });
    const text = extractText(message).replace(/\.$/, "");
    return text || null;
  } catch (err) {
    logger.warn(
      { event: "synthesis_headline_failed", err },
      "Headline generation failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the brief-level synthesis pipeline.
 *
 * One Claude call: generateHeadline. On failure the headline lands as null
 * and the brief publishes without a headline.
 *
 * Throws on empty items[] — synthesis with zero signals has no meaning.
 *
 * @param items             Items in the brief, pre-sorted by sort_order.
 * @param _periodStart      ISO-8601 — currently unused. Reserved for future
 *                          prompts that mention the coverage window.
 * @param _periodEnd        ISO-8601 — same.
 * @param _activeCategories Distinct category labels present in the items.
 *                          Currently unused; the headline prompt sees the
 *                          signals directly.
 */
export async function enrichBriefSynthesis(
  items: BriefItem[],
  _periodStart: string,
  _periodEnd: string,
  _activeCategories: string[]
): Promise<BriefSynthesis> {
  if (items.length === 0) {
    throw new Error("enrichBriefSynthesis: items[] must be non-empty");
  }

  const headline = await generateHeadline(items);

  return { headline };
}

// ---------------------------------------------------------------------------
// runSynthesisSafely — caller-friendly orchestration wrapper
// ---------------------------------------------------------------------------

/**
 * Module-level dispatch object so unit tests can replace the underlying
 * synthesis implementation without restructuring callers. ESM live bindings
 * make it impossible to vi.mock a function that's called from inside its
 * own module by name; routing the call through a property on this object
 * gives tests a stable seam.
 *
 * Production code should not touch this object — call runSynthesisSafely
 * instead.
 */
export const synthesisRuntime: {
  enrichBriefSynthesis: typeof enrichBriefSynthesis;
} = {
  enrichBriefSynthesis
};

/**
 * Non-fatal wrapper around enrichBriefSynthesis intended for use by brief
 * generation orchestrators (briefScheduler.ts daily cron and the POST
 * /generate route).
 *
 * - Empty items → returns null without making any LLM call.
 * - On any thrown error, logs brief_synthesis_failed and returns null so
 *   the caller can persist the brief with synthesis: null rather than
 *   failing the whole generation.
 */
export async function runSynthesisSafely(
  items: BriefItem[]
): Promise<BriefSynthesis | null> {
  if (items.length === 0) return null;

  const activeCategories = Array.from(new Set(items.map((it) => it.category)));

  try {
    return await synthesisRuntime.enrichBriefSynthesis(
      items,
      "",
      "",
      activeCategories
    );
  } catch (err) {
    logger.warn(
      { event: "brief_synthesis_failed", err, itemCount: items.length },
      "Brief-level synthesis failed — proceeding without synthesis"
    );
    return null;
  }
}
