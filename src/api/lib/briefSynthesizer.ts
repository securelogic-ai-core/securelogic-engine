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
import { pg } from "../infra/postgres.js";
import { parseContentJson } from "./parseBriefContentJson.js";
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
   * 3-to-5 sentence executive summary (80–150 words). Names the headline
   * event(s) of THIS week, names who is affected, and calibrates against
   * the prior brief. Description, not action prescription — deadlines and
   * imperative verbs live on the per-item cards. Null on failure.
   */
  exec_summary: string | null;
};

/**
 * Context from the org's most-recent prior published brief, used by the
 * exec summary prompt to write the week-on-week calibration sentence.
 *
 * Threaded through enrichBriefSynthesis → generateExecSummary →
 * buildExecSummaryUserPrompt. When null, the prompt drops the calibration
 * sentence and produces a 3-sentence summary instead of 3-5.
 */
export type PriorBriefContext = {
  period_end: string;
  headline: string | null;
  exec_summary: string | null;
  urgency_mix: { immediate: number; near_term: number; far_term: number };
  category_mix: Record<string, number>;
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
// fetchPriorBriefContext  (I/O — single DB query)
// ---------------------------------------------------------------------------

/**
 * Fetch the org's most-recent published brief (excluding `currentBriefId`)
 * and project it into the shape the exec summary prompt needs.
 *
 * Returns null when:
 *   - no prior published brief exists for this org (first brief case),
 *   - the prior brief's content_json fails to decrypt or parse,
 *   - the prior brief's content_json doesn't carry a categories array.
 *
 * Both values are queried via parseContentJson, which transparently handles
 * the encrypted shape (manual route writes) and the plaintext shape
 * (scheduler writes). Synthesis fields and urgency/category mixes are
 * derived from content_json itself — no JOIN to intelligence_brief_items
 * needed.
 *
 * Non-fatal: any DB failure logs a warning and returns null so the caller
 * can still publish the brief (without the calibration sentence).
 */
export async function fetchPriorBriefContext(
  organizationId: string,
  currentBriefId: string
): Promise<PriorBriefContext | null> {
  try {
    const result = await pg.query<{
      period_end: string;
      content_json: unknown;
    }>(
      `SELECT period_end, content_json
       FROM intelligence_briefs
       WHERE organization_id = $1
         AND status = 'published'
         AND id != $2
       ORDER BY published_at DESC NULLS LAST
       LIMIT 1`,
      [organizationId, currentBriefId]
    );

    const row = result.rows[0];
    if (!row) return null;

    const content = parseContentJson(row.content_json);
    if (!content) return null;

    const synthesis =
      typeof content.synthesis === "object" && content.synthesis !== null
        ? (content.synthesis as Record<string, unknown>)
        : {};
    const headline =
      typeof synthesis.headline === "string" ? synthesis.headline : null;
    const exec_summary =
      typeof synthesis.exec_summary === "string"
        ? synthesis.exec_summary
        : null;

    const categories = Array.isArray(content.categories)
      ? (content.categories as Array<Record<string, unknown>>)
      : [];

    const urgency_mix = { immediate: 0, near_term: 0, far_term: 0 };
    const category_mix: Record<string, number> = {};

    for (const group of categories) {
      const items = Array.isArray(group.items)
        ? (group.items as Array<Record<string, unknown>>)
        : [];
      const cat =
        typeof group.category === "string" ? group.category : "general";
      category_mix[cat] = (category_mix[cat] ?? 0) + items.length;
      for (const item of items) {
        const u = item.urgency;
        if (u === "immediate") urgency_mix.immediate++;
        else if (u === "near_term") urgency_mix.near_term++;
        else if (u === "far_term") urgency_mix.far_term++;
      }
    }

    return {
      period_end: row.period_end,
      headline,
      exec_summary,
      urgency_mix,
      category_mix
    };
  } catch (err) {
    logger.warn(
      { event: "prior_brief_context_fetch_failed", organizationId, err },
      "Prior brief context fetch failed — synthesis will run without calibration"
    );
    return null;
  }
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

async function generateHeadline(
  items: BriefItem[],
  organizationId: string | null = null
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (items.length === 0) return null;

  logger.info(
    { event: "llm_call_start", purpose: "brief_headline", model: CLAUDE_MODEL, organizationId },
    "LLM call: brief headline"
  );

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
      { event: "synthesis_headline_failed", organizationId, err },
      "Headline generation failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// generateExecSummary — single Claude call producing { teaser, exec_summary }
// ---------------------------------------------------------------------------
//
// Prompt revision: the previous version optimized for "decision compression"
// and produced output that read like another action item (deadlines in every
// sentence, imperative verbs at S3). Customer feedback: the exec summary is
// the thing the reader scrolls past to get to the items, when it should be
// the thing they read to decide whether to keep reading. The prompt below
// reframes the task as summary, not action prescription — per-item action
// and deadlines remain on the signal cards.
//
// Bumped max_tokens 350 → 450 to accommodate up to 5 sentences plus the
// week-on-week calibration sentence. Temperature pinned at 0.5: the new
// prompt is lighter on prescription, so a lower temp keeps voice stable.

export const EXEC_SUMMARY_SYSTEM_PROMPT =
  "You are writing the executive summary for a weekly cyber risk intelligence brief read by CISOs, GRC leaders, and security engineers at mid-to-large enterprises. " +
  "The reader subscribes to this brief; they read the previous one and will read the next one. " +
  "Your job is summary, not action prescription. Per-item action and deadlines live on the signal cards below — do not duplicate that work here. " +
  "The executive summary's job is to tell the reader what is in this week's brief, who it affects, and how it differs from last week's. " +
  "Voice: a senior analyst writing to a CISO who has seen 200 of these. Confident, specific, comparative, restrained. Not breathless, not corporate.";

function trim(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

function buildExecSummarySignalLines(items: BriefItem[]): string {
  return items
    .slice(0, 12)
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

function formatPriorBlock(prior: PriorBriefContext): string {
  const periodEnd = String(prior.period_end).slice(0, 10);
  const headlineText = prior.headline ?? "(none)";
  const execText = prior.exec_summary ?? "(none)";
  const u = prior.urgency_mix;
  const catEntries = Object.entries(prior.category_mix).sort(
    (a, b) => b[1] - a[1]
  );
  const catLine =
    catEntries.length > 0
      ? catEntries.map(([k, v]) => `${k}: ${v}`).join(", ")
      : "(none)";
  return [
    `LAST WEEK's brief (period ending ${periodEnd}):`,
    `- headline: "${headlineText}"`,
    `- exec_summary: "${execText}"`,
    `- urgency mix: ${u.immediate} immediate, ${u.near_term} near-term, ${u.far_term} far-term`,
    `- category mix: ${catLine}`
  ].join("\n");
}

export function buildExecSummaryUserPrompt(
  signalLines: string,
  priorContext: PriorBriefContext | null
): string {
  const priorBlock = priorContext
    ? `\n\n${formatPriorBlock(priorContext)}`
    : "";

  return `Below is the prioritized list of signals in this week's brief, plus context from last week's brief if available. Use this material to write the executive summary that opens this week's brief.

Signals in THIS WEEK's brief (in priority order):
${signalLines}${priorBlock}

Return JSON only with exactly two fields: teaser, exec_summary.

teaser
- One sentence. 18-24 words.
- The dashboard-card hook. Names the central threat THIS BRIEF and the action it forces.
- Must make a reader who skims past it understand what is at stake and why they should open the brief.

exec_summary
- 3 to 5 sentences. 80-150 words total.
- This is a SUMMARY, not the action layer. Action and deadlines belong on the per-item cards. Do not embed deadlines like "by Friday" or "within 48 hours" in the exec summary.

S1 — name the headline event(s) of THIS WEEK in plain language. Reference one or two specific items by vendor, CVE, regulation, or threat actor. No setup ("This week's signals show...", "The security landscape..." — never). If multiple items center on the same theme (e.g., three Cisco vulnerabilities, two regulatory items), say so explicitly — that's the headline. Don't pick one item arbitrarily and bury the cluster. The shape of the brief is itself information; if 8 of 12 items are vulnerabilities, that's the lede.

S2 — name the specific function or sector that owns the dominant exposure this week (not "organizations" generically — name the function: "network engineering teams", "compliance leaders at listed companies", "hospital security teams"). Characterize what that group's working week looks like in light of these items in one sentence. Descriptive, not prescriptive. Do not list actions.

S3 — calibrate against last week. What is different about THIS brief compared to LAST WEEK's? Use the prior brief's data above. Examples of valid calibrations: "the mix shifts hard toward vulnerabilities (8 of 12) vs last week's regulatory-heavy distribution (2 of 12)", "two new threat-actor lineages appear that were absent last week", "patch surface narrows considerably from last week's Cisco-and-Fortinet wave". If no prior brief is available (priorContext absent from the material above), OMIT this sentence and produce a 3-sentence summary from S1, S2, and one closing observation in the spirit of S4 — a notable absence, a comparison to a prior month's pattern, or a single second-order observation. Without prior calibration, the closing sentence becomes mandatory rather than optional.

S4-S5 (optional, only if warranted) — a notable absence, a comparison to a prior month's pattern, or a single second-order observation. Skip these by default. Most weeks do not need them.

HARD AVOID:
1. Magazine voice — "the convergence of X and Y", "this represents a systemic shift", "marks a pivotal moment", "has moved from X to Y".
2. Setup / throat-clearing — "This week's signals show", "The security landscape", "Industrial control system security has", any framing sentence before the substance.
3. Generic governance language — "organizations should review", "this highlights the importance", "teams should consider", "this underscores".
4. False urgency — do not claim this week is unprecedented unless it actually is. Most weeks are not.
5. Action prescription — no deadlines, no "by Wednesday", no imperative verbs aimed at the reader. The action layer lives on the per-item cards. The summary's job is description, not direction.
6. Corporate hedging — "may", "could", "potentially". Say what you see.
7. Embedded-clause sprawl — no sentence with three commas. No em-dash mid-clause inside a 30-word run.

GOOD examples (the shape you are aiming for):

Example A (with prior context — 4 sentences, 109 words):
{
  "teaser": "Three of this week's twelve items center on actively-exploited Cisco IOS XE vulnerabilities now on the federal KEV list.",
  "exec_summary": "Three of this week's twelve items center on actively-exploited Cisco IOS XE vulnerabilities (CVE-2026-XXXX, CVE-2026-YYYY) added to the federal KEV catalog within 48 hours of disclosure. Network engineering teams running internet-exposed IOS XE carry the dominant exposure this week — not the parallel ransomware coverage, which is steady-state. The mix shifts hard toward infrastructure vulnerabilities (8 of 12) compared to last week's breach-heavy distribution (3 of 12), reflecting the late-cycle Cisco patch release. Notably absent: any new SEC enforcement activity after three consecutive weeks of named-CISO actions."
}

Example B (no prior context — 3 sentences, 76 words):
{
  "teaser": "The regulatory layer dominates this week: NYDFS amendments take effect November 1 alongside two named-CISO SEC actions.",
  "exec_summary": "The regulatory layer dominates this week: NYDFS Cybersecurity Regulation amendments take effect November 1 alongside two SEC enforcement actions naming named CISOs. Compliance leaders at financial institutions and listed companies — not just security functions — carry the primary exposure on these items. Vulnerability and threat-actor activity is unusually quiet; the patching backlog is the lower priority this week."
}

Return JSON only — no surrounding prose, no markdown fences.`;
}

/**
 * Single Claude call producing { teaser, exec_summary }. Returns nulls
 * for both fields on any failure (API key absent, network error, JSON
 * parse error, missing fields). Never throws.
 *
 * `priorContext` (when provided) is rendered into the user prompt as a
 * "LAST WEEK's brief" block so the model can write the week-on-week
 * calibration sentence (S3). When null, the prompt instructions tell the
 * model to omit S3 and produce a 3-sentence summary.
 */
async function generateExecSummary(
  items: BriefItem[],
  priorContext: PriorBriefContext | null,
  organizationId: string | null = null
): Promise<{ teaser: string | null; exec_summary: string | null }> {
  const empty = { teaser: null, exec_summary: null };
  const client = getClient();
  if (!client) return empty;
  if (items.length === 0) return empty;

  logger.info(
    { event: "llm_call_start", purpose: "brief_exec_summary", model: CLAUDE_MODEL, organizationId },
    "LLM call: brief exec summary"
  );

  const signalLines = buildExecSummarySignalLines(items);
  const userPrompt = buildExecSummaryUserPrompt(signalLines, priorContext);

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 450,
      temperature: 0.5,
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
      { event: "synthesis_exec_summary_failed", organizationId, err },
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
 * @param priorContext      Prior published brief's synthesis + mixes,
 *                          fetched by callers via fetchPriorBriefContext.
 *                          When null, the exec summary prompt drops the
 *                          calibration sentence.
 */
export async function enrichBriefSynthesis(
  items: BriefItem[],
  _periodStart: string,
  _periodEnd: string,
  _activeCategories: string[],
  priorContext: PriorBriefContext | null,
  organizationId: string | null = null
): Promise<BriefSynthesis> {
  if (items.length === 0) {
    throw new Error("enrichBriefSynthesis: items[] must be non-empty");
  }

  const [headline, exec] = await Promise.all([
    generateHeadline(items, organizationId),
    generateExecSummary(items, priorContext, organizationId)
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
 *
 * `priorContext` is opaque pass-through to enrichBriefSynthesis — callers
 * fetch it via fetchPriorBriefContext before invoking this wrapper. Pass
 * null for first-brief-ever cases or when the caller intentionally skips
 * calibration.
 */
export async function runSynthesisSafely(
  items: BriefItem[],
  priorContext: PriorBriefContext | null,
  organizationId: string | null = null
): Promise<BriefSynthesis | null> {
  if (items.length === 0) return null;

  const activeCategories = Array.from(new Set(items.map((it) => it.category)));

  try {
    return await synthesisRuntime.enrichBriefSynthesis(
      items,
      "",
      "",
      activeCategories,
      priorContext,
      organizationId
    );
  } catch (err) {
    logger.warn(
      { event: "brief_synthesis_failed", organizationId, err, itemCount: items.length },
      "Brief-level synthesis failed — proceeding without synthesis"
    );
    return null;
  }
}
