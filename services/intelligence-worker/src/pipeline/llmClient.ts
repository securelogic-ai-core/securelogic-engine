/**
 * llmClient.ts
 *
 * LLM-backed analysis functions for the intelligence pipeline.
 *
 * All functions fail gracefully: if ANTHROPIC_API_KEY is not set, or if any
 * API call fails, they return null. Callers must handle null and decide whether
 * to hold the content or publish with raw database fields.
 *
 * Model strategy:
 *   - claude-haiku-4-5: per-signal analysis (cost at scale, ~15-20 signals/brief)
 *   - claude-sonnet-4-6: brief-level synthesis, cross-domain analysis, action summary
 *     (quality is the priority here — these are the premium editorial sections)
 *
 * Typical brief cost: ~$0.05–0.15 total (haiku signals + sonnet synthesis).
 *
 * TENANT NOTE
 * -----------
 * Calls in this module operate on PUBLIC-SOURCE signal data only (CISA KEV,
 * NVD, MITRE, public vendor advisories). Inputs are not customer-private,
 * so cross-org batching is permitted under TENANT_ISOLATION_STANDARD.md §6.
 * Per-org consumption (briefs, findings) happens in src/api/lib/* downstream
 * with explicit organizationId logging.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../../../src/api/infra/logger.js";
import { instrumentAnthropicClient } from "../../../../src/api/infra/providerQuotaAlert.js";

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key }));
}

export type SignalAnalysis = {
  analysis: string;
  whyItMatters: string;
  recommendedAction: string;
  riskRationale?: string;
};

export type ActionSummary = {
  thisWeek: string[];
  thisMonth: string[];
  monitor: string[];
};

// ---------------------------------------------------------------------------
// Per-signal analysis (Haiku — cost efficient at scale)
// ---------------------------------------------------------------------------

// Sources whose origin adds authoritative weight and should be referenced in analysis.
const AUTHORITATIVE_SOURCES = [
  "cisa", "nvd", "nist", "fbi", "certs", "us-cert", "msrc",
  "sec.gov", "fda", "ncsc", "enisa", "europol"
];

/**
 * Builds the per-signal analysis prompt.
 * Exported for unit testing.
 */
export function buildSignalPrompt(
  title: string,
  content: string,
  category: string,
  source: string,
  cve?: string | null,
  vendor?: string | null,
  riskLevel?: string | null
): string {
  // Increased from 1200 → 3000: CVE advisories, breach reports, and regulatory
  // texts routinely need 2500+ chars before reaching version numbers, CVSS scores,
  // enforcement deadlines, and affected product lists that make analysis specific.
  const excerpt = content.slice(0, 3000).replace(/\n+/g, " ").trim();

  const cveField = cve ? `CVE: ${cve}` : "";
  const vendorField = vendor ? `Vendor/Product: ${vendor}` : "";
  const riskField = riskLevel ? `Risk Level: ${riskLevel.toUpperCase()}` : "";
  const contextLines = [cveField, vendorField, riskField].filter(Boolean).join("\n");

  const sourceIsAuthoritative = AUTHORITATIVE_SOURCES.some((s) =>
    source.toLowerCase().includes(s)
  );
  const sourceNote = sourceIsAuthoritative
    ? `\nNote: This signal originates from ${source} — an authoritative government or standards body. Reference the source authority by name in your analysis.`
    : "";

  const isHighPriority =
    riskLevel?.toLowerCase() === "critical" || riskLevel?.toLowerCase() === "high";

  return `You are a risk intelligence analyst writing for enterprise CISOs, security leaders, and compliance teams.

Signal: ${title}
Source: ${source}
Category: ${category}
${contextLines ? `${contextLines}\n` : ""}${excerpt ? `Content: ${excerpt}` : ""}${sourceNote}

Write a specific, enterprise-focused analysis of this signal. Requirements:
- Name the specific product, vendor, regulation, CVE, actor, or agency involved — never write "a software product" or "an organization"
- Explain the specific enterprise exposure, not a generic risk category
- The action must name a responsible function (security team, compliance team, procurement, legal) and a time horizon
- Write for a CISO who reads 50 news items a day — give them something they can't get from a headline
${cve ? `- The CVE identifier (${cve}) must appear in the analysis if patch status or CVSS scoring is known` : ""}
${vendor ? `- Reference ${vendor} by name in the recommended action` : ""}
${isHighPriority ? `- This signal is rated ${riskLevel!.toUpperCase()}. State the urgency directly. Do not qualify, soften, or hedge the risk or the required action.` : ""}

Return valid JSON only — no markdown, no code fences:
{
  "analysis": "2-3 sentences. What specifically happened, who is affected, and what the enterprise exposure is. Be specific to this signal.",
  "whyItMatters": "1-2 sentences on the specific business risk, control gap, or compliance implication. Name the exposure — not a generic risk category.",
  "recommendedAction": "One specific, concrete action with a named function and time horizon. Example: 'Security team: audit all Fortinet VPN deployments for CVE-2025-XXXX and apply the emergency patch within 72 hours.' Not: 'Review your controls.'"
}`;
}

/**
 * Phrases that indicate the LLM produced generic template output rather than
 * signal-specific analysis. Exported for unit testing.
 *
 * When any of these appear in the combined analysis+whyItMatters+action text,
 * the result is discarded and the signal falls back to raw DB fields.
 */
export const GENERIC_QUALITY_GATE_PHRASES = [
  // Original set
  "validate applicability",
  "assign ownership",
  "confirm existing controls",
  "determine whether escalation",
  "review your controls",
  "if unaddressed",
  "enterprise impact if response lags",
  "risk posture and should be evaluated",
  // Extended: common LLM hedging and generic framing patterns
  "organizations should be aware",
  "this development may",
  "this development reflects",
  "may affect enterprise",
  "highlights the need",
  "highlights the importance",
  "demonstrates the importance",
  "could potentially",
  "security teams should review",
  "organizations should review",
  "should consider reviewing",
  "underscores the importance",
  "serves as a reminder"
];

/**
 * Analyze a single signal using the LLM.
 * Returns null if the API key is absent or the call fails.
 */
export async function analyzeSignal(
  title: string,
  content: string,
  category: string,
  source: string,
  cve?: string | null,
  vendor?: string | null,
  riskLevel?: string | null
): Promise<SignalAnalysis | null> {
  const client = getClient();
  if (!client) return null;

  // organizationId is intentionally null — this call operates on
  // public-source signal data and is permitted to be batch-run for all orgs.
  // See TENANT_ISOLATION_STANDARD.md §6.
  logger.info(
    { event: "llm_call_start", purpose: "signal_analysis", model: "claude-haiku-4-5-20251001", organizationId: null, title },
    "LLM call: per-signal analysis (public-source)"
  );

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: buildSignalPrompt(title, content, category, source, cve, vendor, riskLevel)
        }
      ]
    });

    const raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<SignalAnalysis>;

    if (!parsed.analysis || !parsed.whyItMatters || !parsed.recommendedAction) {
      logger.warn(
        { event: "llm_signal_incomplete", title },
        "LLM signal analysis returned incomplete fields"
      );
      return null;
    }

    const combined = `${parsed.analysis} ${parsed.whyItMatters} ${parsed.recommendedAction}`.toLowerCase();
    const isGeneric = GENERIC_QUALITY_GATE_PHRASES.some((phrase) => combined.includes(phrase));

    if (isGeneric) {
      logger.warn(
        { event: "llm_signal_generic", title },
        "LLM signal analysis contains generic template language — discarding"
      );
      return null;
    }

    return {
      analysis: parsed.analysis.trim(),
      whyItMatters: parsed.whyItMatters.trim(),
      recommendedAction: parsed.recommendedAction.trim()
    };
  } catch (err) {
    logger.warn(
      { event: "llm_signal_analysis_failed", title, err },
      "LLM signal analysis failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Risk rationale for top-priority signals (Haiku)
// ---------------------------------------------------------------------------

/**
 * Generate a scoring rationale for a top-priority signal.
 * Explains *why* this signal scored Critical/High — not just that it did.
 */
export async function generateRiskRationale(
  title: string,
  riskLevel: string,
  analysis: string,
  category: string
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `You are a risk scoring analyst. In 1-2 sentences, explain specifically why this signal was scored ${riskLevel.toUpperCase()}. Reference the actual attributes that drove the score (e.g., active exploitation confirmed, no patch available, regulatory enforcement deadline, widespread affected product). Do not just restate the risk level.

Signal: ${title}
Category: ${category}
Analysis: ${analysis}

Return plain text only.`
        }
      ]
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    return text || null;
  } catch (err) {
    logger.warn({ event: "llm_risk_rationale_failed", title, err }, "Risk rationale generation failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Brief-level synthesis (Sonnet — quality matters most here)
// ---------------------------------------------------------------------------

function buildSynthesisPrompt(
  topSignals: Array<{ title: string; riskLevel: string }>,
  activeCategories: string[],
  totalCount: number
): string {
  const signalLines = topSignals
    .slice(0, 5)
    .map((s, i) => `${i + 1}. [${s.riskLevel.toUpperCase()}] ${s.title}`)
    .join("\n");

  return `You are the editor of a premium enterprise risk intelligence brief read by CISOs, risk leaders, and compliance teams at large organizations.

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
}

/**
 * Generate a brief-level editorial synthesis paragraph.
 * Returns null if the API key is absent or the call fails.
 */
export async function synthesizeBrief(
  topSignals: Array<{ title: string; riskLevel: string }>,
  activeCategories: string[],
  totalSignalCount: number
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  if (topSignals.length === 0) return null;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: buildSynthesisPrompt(topSignals, activeCategories, totalSignalCount)
        }
      ]
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    return text || null;
  } catch (err) {
    logger.warn(
      { event: "llm_brief_synthesis_failed", err },
      "LLM brief synthesis failed"
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Thesis headline (Sonnet)
// ---------------------------------------------------------------------------

/**
 * Generate a one-sentence thesis headline for this issue.
 * This is the brief's identity — different from the generic weekly title.
 */
export async function generateThesisHeadline(
  synthesis: string,
  topSignals: Array<{ title: string; riskLevel: string }>
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const signalLines = topSignals
    .slice(0, 3)
    .map((s) => `[${s.riskLevel.toUpperCase()}] ${s.title}`)
    .join("\n");

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 80,
      messages: [
        {
          role: "user",
          content: `Write a single-sentence thesis headline for this week's intelligence brief. It should capture the dominant risk theme as a declarative statement — not a title, not a question.

Synthesis: ${synthesis}

Top signals:
${signalLines}

Example good headlines:
- "AI governance liability collides with active exploit exposure in a high-pressure week for enterprise risk teams."
- "Regulatory enforcement timelines compress as three simultaneous compliance deadlines converge on the same enterprise functions."

Return plain text only. One sentence. No trailing period needed.`
        }
      ]
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim()
      .replace(/\.$/, "");

    return text || null;
  } catch (err) {
    logger.warn({ event: "llm_thesis_headline_failed", err }, "Thesis headline generation failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cross-domain analysis (Sonnet)
// ---------------------------------------------------------------------------

export type CrossDomainSignalInput = {
  title: string;
  category: string;
  riskLevel: string;
  analysis: string;
};

/**
 * Generate a cross-domain analysis identifying patterns that connect signals
 * across different risk categories. This is the highest-value editorial section.
 *
 * Returns null if no meaningful cross-domain pattern exists or the call fails.
 */
export async function generateCrossDomainAnalysis(
  signals: CrossDomainSignalInput[]
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  // Need signals from at least 2 different categories
  const categories = new Set(signals.map((s) => s.category));
  if (categories.size < 2) return null;

  const signalLines = signals
    .slice(0, 10)
    .map((s) => `[${s.category} / ${s.riskLevel.toUpperCase()}] ${s.title}: ${s.analysis.slice(0, 150)}`)
    .join("\n");

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are a senior risk intelligence analyst writing for enterprise security and compliance leaders.

Review these signals from this week's brief and identify the most significant pattern that connects signals across different risk categories. Not every brief will have one — only write this if a genuine connection exists.

This week's signals:
${signalLines}

If a meaningful cross-domain pattern exists: write 1-2 paragraphs that:
- Name the specific signals involved (use their actual titles)
- Explain the connecting risk thread in concrete terms
- State what this means for an enterprise — what single work item or risk conversation this creates
- Do NOT write generic observations like "signals this week span multiple domains"

If no meaningful cross-domain pattern exists, return exactly: NO_PATTERN

Return plain text only.`
        }
      ]
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    if (!text || text === "NO_PATTERN") return null;

    return text;
  } catch (err) {
    logger.warn({ event: "llm_cross_domain_failed", err }, "Cross-domain analysis generation failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Action summary (Sonnet)
// ---------------------------------------------------------------------------

/**
 * Generate a consolidated action summary from all signals in the brief.
 * Three lists: this week (24-72h), this month, and ongoing monitor items.
 */
export async function generateActionSummary(
  signals: CrossDomainSignalInput[]
): Promise<ActionSummary | null> {
  const client = getClient();
  if (!client) return null;

  if (signals.length === 0) return null;

  const signalLines = signals
    .slice(0, 12)
    .map((s) => `[${s.category} / ${s.riskLevel.toUpperCase()}] ${s.title}: ${s.analysis.slice(0, 200)}`)
    .join("\n");

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `You are a risk intelligence analyst creating an action summary for a CISO. This is the section they will hand to their team on Monday morning.

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

Include 2-3 items per list. Omit a list item if there is no specific signal to support it.`
        }
      ]
    });

    const raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    // Attempt to repair truncated JSON by closing any unclosed brackets/braces
    let repaired = cleaned;
    let parsed: Partial<ActionSummary>;
    try {
      parsed = JSON.parse(repaired) as Partial<ActionSummary>;
    } catch {
      // Count unclosed brackets and attempt to close them
      const openBraces = (repaired.match(/\{/g) ?? []).length - (repaired.match(/\}/g) ?? []).length;
      const openBrackets = (repaired.match(/\[/g) ?? []).length - (repaired.match(/\]/g) ?? []).length;
      // Trim trailing incomplete string/token before closing
      repaired = repaired.replace(/,?\s*"[^"]*$/, "").replace(/,\s*$/, "");
      repaired += "]".repeat(Math.max(0, openBrackets)) + "}".repeat(Math.max(0, openBraces));
      logger.warn(
        { event: "llm_action_summary_json_repaired", originalLength: cleaned.length, repairedLength: repaired.length },
        "Action summary JSON was truncated — attempted repair"
      );
      parsed = JSON.parse(repaired) as Partial<ActionSummary>;
    }

    if (!parsed.thisWeek && !parsed.thisMonth && !parsed.monitor) return null;

    return {
      thisWeek: Array.isArray(parsed.thisWeek) ? parsed.thisWeek : [],
      thisMonth: Array.isArray(parsed.thisMonth) ? parsed.thisMonth : [],
      monitor: Array.isArray(parsed.monitor) ? parsed.monitor : []
    };
  } catch (err) {
    logger.warn({ event: "llm_action_summary_failed", err }, "Action summary generation failed");
    return null;
  }
}
