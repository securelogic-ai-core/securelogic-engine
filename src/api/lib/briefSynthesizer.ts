/**
 * briefSynthesizer.ts — Brief-level synthesis (top-of-brief headline +
 * executive summary).
 *
 * Two parallel Claude calls per brief:
 *   1. generateHeadline    — 12-word declarative one-liner.
 *   2. generateExecSummary — { teaser, exec_summary }: a one-sentence
 *                            dashboard hook plus a 60–110 word
 *                            three-sentence directive paragraph.
 *
 * Per-signal urgency, action, and context live on each BriefItem (set
 * by intelligenceBriefGenerator.enrichItemWithClaude). The synthesis layer
 * here sits ABOVE those — it answers "if you read only this top of the
 * brief, what would you do today?".
 *
 * Architecturally separate from intelligenceBriefGenerator.ts. The latter
 * runs item-level enrichment (one Claude call per item). This module runs
 * brief-level synthesis (two parallel Claude calls).
 *
 * History — this module previously ran four Claude calls per brief
 * (executive summary, thesis headline, cross-domain analysis, action
 * summary) producing magazine-shaped output. The customer rejected that;
 * we collapsed to a single 12-word headline. The exec_summary added here
 * is a deliberately constrained successor: directive prose, named-day
 * deadlines, role-named exposure, no narrative voice. The prompt was
 * iterated 5x against staging-brief data before integration; per-sentence
 * word caps and a max_tokens=350 ceiling keep total output in the
 * 60–110 word band. The CVE grounding + JSON repair helpers below are
 * retained for the per-item enrichment validator (planned follow-up).
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
  /**
   * One-sentence (18–24 word) dashboard-card hook. Names the central
   * threat in this brief and the action it forces. Null on failure.
   */
  teaser: string | null;
  /**
   * Three-sentence directive paragraph (60–110 words). Sentence 1 is the
   * most urgent action with a specific deadline. Sentence 2 names who is
   * exposed and ends on a verb that role can take this week. Sentence 3
   * is the instruction set for this week. Null on failure.
   */
  exec_summary: string | null;
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
// generateExecSummary — single Claude call producing { teaser, exec_summary }
// ---------------------------------------------------------------------------
//
// The prompt below was iterated 5x against the 2026-04-30 staging brief
// (53-item OT-heavy mix) before integration. Convergence properties at
// max_tokens=350:
//   - 3-run total word counts: 110 / 93 / 102 (target 60–110)
//   - S1 deadlines: business intervals or named days, no bare "now"/"today"
//   - S2 deadlines: named day, every run
//   - Avoid-list (magazine voice / observational verbs / generic governance)
//     held clean across runs
//
// Do not relax max_tokens or strip per-sentence caps without re-running the
// driver script (scripts/run-exec-summary-once.mjs) first.

const EXEC_SUMMARY_SYSTEM_PROMPT =
  "You are writing the executive summary for a weekly cyber risk intelligence brief read by CISOs, GRC leaders, and security engineers at mid-to-large enterprises. " +
  "Your job is decision compression. Every sentence you write must leave the reader with a concrete decision lever in hand. " +
  "You are writing a memo to a busy operator, not an essay.";

function trim(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

function buildExecSummarySignalLines(items: BriefItem[]): string {
  return items
    .slice(0, 10)
    .map((item, i) => {
      const urgency = (item.urgency ?? "unclassified").toUpperCase();
      const sev = (item.severity ?? "").toUpperCase();
      const rel = (item.relevance ?? "").toUpperCase();
      const cve = item.affected_cve ? ` ${item.affected_cve}` : "";
      const vendor = item.affected_vendor ? ` (${item.affected_vendor})` : "";
      const title = trim(item.title, 90);

      // why_it_matters is the analyst-grade per-item directive distillation
      // set by enrichItemWithClaude. Falls back to summary on the rare item
      // where enrichment failed and the fallback didn't populate why.
      const context = item.why_it_matters ?? item.summary ?? "";
      const contextLine = trim(context, 240);

      const firstLine = (item.recommended_actions ?? "")
        .split("\n")
        .map((s) => s.trim())
        .find(Boolean);
      const firstAction = trim(
        firstLine ? firstLine.replace(/^\d+\.\s*/, "") : "",
        180
      );

      const lines = [
        `[${i + 1}] [${urgency} | ${rel} | ${sev}]${cve}${vendor} ${title}`,
        `    why: ${contextLine}`,
      ];
      if (firstAction) lines.push(`    action1: ${firstAction}`);
      return lines.join("\n");
    })
    .join("\n");
}

function buildExecSummaryUserPrompt(signalLines: string): string {
  return `Below is the prioritized list of signals in this week's brief. Each is already enriched with urgency, why_it_matters, and one recommended action.

Signals (top 10, in priority order):
${signalLines}

Return JSON only with exactly two fields: teaser, exec_summary.

teaser
- One sentence. 18–24 words.
- The dashboard-card hook. Names the central threat THIS BRIEF and the action it forces.
- Must make a reader who skims past it understand what is at stake and why they should open the brief.

exec_summary
- Exactly three sentences. STRICT: 60–110 words total. Per-sentence caps: S1 20–30 words, S2 25–35 words, S3 25–40 words. If you would exceed 110 total, cut the CVE list in S1 to three vendors max. Do NOT truncate S3's instruction list — the actions are the deliverable.
- The "if you read only this paragraph and skipped the rest of the brief, what would you do today?" passage.
- Sentence 1: the most urgent thing that must happen — name the specific vendor/CVE/regulation, name the action. Must include a specific deadline (named day, calendar date, or business interval like "within 24 hours"). Reject "now", "immediately", "today" as standalone deadlines unless paired with a more specific bound (e.g. "today before market open" is acceptable, "today" alone is not).
- Sentence 2: names who is specifically exposed (function/role/sector — not "organizations" generically) AND ends on a verb the named role can take, bounded by a specific deadline (named day of the week, calendar date, or business interval like "48 hours" or "before market open"). Acceptable verb shapes: "should pull X by Wednesday", "escalate Y by close of business Friday", "confirm Z within 48 hours". Reject observational verbs that describe state without prescribing action: "owns", "faces", "is exposed to", "must contend with", "is on the table", "is at risk". Reject vague time horizons: "soon", "this period", "in the near term", "going forward". The sentence must leave the named role with a lever they pull on a specific day, not a fact they remember.
- Sentence 3: the instruction for this week. Must open with an imperative verb. Must leave the reader with a concrete decision lever in hand.
- DIRECTIVE, not descriptive. Tells the reader what to decide, does not narrate what is happening.

HARD AVOID:
1. Magazine voice — "has moved from X to Y", "the convergence of A and B is no coincidence", "this represents a systemic shift". You are writing a memo, not an essay.
2. Pattern-claim filler — "this reflects a single underlying exposure", "represents a systemic trust failure", "is not just a patching event".
3. Setup / throat-clearing — never open with "Industrial control system security has", "This week's signals show", "The security landscape is", or any framing sentence before the directive.
4. Embedded-clause sprawl — no sentence with three commas. No em-dash mid-clause inside a 30-word run. Plain subject-verb-object.
5. Generic governance/risk language — never write "organizations should review", "this highlights the importance", "teams should consider", "this underscores".
6. Descriptive vs directive — every sentence must leave the reader with a concrete decision lever. The third sentence in particular must instruct, not observe. If a sentence could be deleted without changing what the reader does today, it is the wrong sentence.

GOOD examples (the shape you are aiming for):

Example A:
{
  "teaser": "A Rhysida-affiliate hospital ransomware wave is in active triage with a 60-day HHS breach notification clock already running for affected health systems.",
  "exec_summary": "Confirm whether your hospital network sits in the Rhysida-affiliate ransomware wave by Wednesday — three providers have published incident notices in the past five days and the EHR-tooling vector overlaps with widely used remote-access stacks. Hospital security leaders, IR retainers, and HIPAA privacy officers at regional health systems should pull EHR vendor exposure reports and confirm offline-backup integrity by Friday. Tighten EDR detections for Rhysida loaders this week, freeze elective patient-portal feature releases until the wave clears, and brief your privacy officer on the 60-day notification clock if any system shows compromise indicators."
}

Example B:
{
  "teaser": "A credential-stuffing wave against a major payments processor has triggered SEC Item 1.05 disclosure clocks at three downstream brokerages this week.",
  "exec_summary": "Determine materiality on the StackPay credential-stuffing breach by Tuesday — three downstream broker-dealers have filed Item 1.05 8-Ks and the SEC's 4-business-day disclosure window starts the moment your team confirms reasonable belief of material impact. CISOs, in-house counsel, and disclosure committee members at any firm with StackPay-routed payment flows should map customer exposure and escalate the materiality determination to the audit committee by Wednesday. Rotate StackPay API credentials today, force a session reset across all customer accounts that authenticated since March 1, and stage draft 8-K language with counsel before Thursday's market open."
}

Return JSON only — no surrounding prose, no markdown fences.`;
}

/**
 * Single Claude call producing { teaser, exec_summary }. Returns nulls
 * for both fields on any failure (API key absent, network error, JSON
 * parse error, missing fields). Never throws.
 */
async function generateExecSummary(
  items: BriefItem[]
): Promise<{ teaser: string | null; exec_summary: string | null }> {
  const empty = { teaser: null, exec_summary: null };
  const client = getClient();
  if (!client) return empty;
  if (items.length === 0) return empty;

  const signalLines = buildExecSummarySignalLines(items);
  const userPrompt = buildExecSummaryUserPrompt(signalLines);

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 350,
      system: EXEC_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    });

    const rawText = extractText(message);
    // Strip markdown code fences if Claude wrapped the JSON — same pattern
    // as intelligenceBriefGenerator.ts:638.
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleaned) as {
      teaser?: unknown;
      exec_summary?: unknown;
    };

    const teaser =
      typeof parsed.teaser === "string" && parsed.teaser.trim().length > 0
        ? parsed.teaser.trim()
        : null;
    const exec_summary =
      typeof parsed.exec_summary === "string" &&
      parsed.exec_summary.trim().length > 0
        ? parsed.exec_summary.trim()
        : null;

    return { teaser, exec_summary };
  } catch (err) {
    logger.warn(
      { event: "synthesis_exec_summary_failed", err },
      "Exec summary generation failed"
    );
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the brief-level synthesis pipeline.
 *
 * Two Claude calls in parallel:
 *   1. generateHeadline    → headline
 *   2. generateExecSummary → { teaser, exec_summary }
 *
 * Each call fails independently. On any single failure the corresponding
 * fields land as null and the brief publishes without them.
 *
 * Throws on empty items[] — synthesis with zero signals has no meaning.
 *
 * @param items             Items in the brief, pre-sorted by sort_order.
 *                          Should be post-enrichment (why_it_matters,
 *                          recommended_actions, urgency populated).
 * @param _periodStart      ISO-8601 — currently unused. Reserved for future
 *                          prompts that mention the coverage window.
 * @param _periodEnd        ISO-8601 — same.
 * @param _activeCategories Distinct category labels present in the items.
 *                          Currently unused; the prompts see the signals
 *                          directly.
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

  const [headline, exec] = await Promise.all([
    generateHeadline(items),
    generateExecSummary(items)
  ]);

  return {
    headline,
    teaser: exec.teaser,
    exec_summary: exec.exec_summary
  };
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
