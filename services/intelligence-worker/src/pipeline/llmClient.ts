/**
 * llmClient.ts
 *
 * LLM-backed analysis functions for the intelligence pipeline.
 *
 * All functions fail gracefully: if ANTHROPIC_API_KEY is not set, or if any
 * API call fails, they return null. Callers must fall back to template
 * analysis when null is returned.
 *
 * Model: claude-haiku-4-5 — fast and inexpensive for per-signal analysis.
 * Typical brief cost: ~$0.01–0.03 for 15–20 signals + 1 synthesis call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../../../src/api/infra/logger.js";

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

export type SignalAnalysis = {
  analysis: string;
  whyItMatters: string;
  recommendedAction: string;
};

function buildSignalPrompt(
  title: string,
  content: string,
  category: string,
  source: string
): string {
  const excerpt = content.slice(0, 600).replace(/\n+/g, " ").trim();

  return `You are a risk intelligence analyst writing for enterprise security, compliance, and governance leaders.

Signal: ${title}
Source: ${source}
Category: ${category}
${excerpt ? `Content: ${excerpt}` : ""}

Analyze this specific signal for enterprise risk relevance. Return valid JSON only — no markdown, no code fences:
{
  "analysis": "2-3 sentences. Explain what specifically happened and why it matters for enterprise security or compliance teams. Be specific to this signal. Do not start with 'The event reported in' or 'The development reported in'.",
  "whyItMatters": "1-2 sentences on the specific business risk, control gap, or compliance implication this creates for an enterprise.",
  "recommendedAction": "One specific, concrete action a security or risk team can take this week in direct response to this signal."
}`;
}

function buildSynthesisPrompt(
  topSignals: Array<{ title: string; riskLevel: string }>,
  activeCategories: string[],
  totalCount: number
): string {
  const signalLines = topSignals
    .slice(0, 5)
    .map((s, i) => `${i + 1}. [${s.riskLevel.toUpperCase()}] ${s.title}`)
    .join("\n");

  return `You are a risk intelligence editor writing a weekly brief for enterprise CISOs, risk leaders, and compliance teams.

This week's brief covers ${totalCount} signals across: ${activeCategories.join(", ")}.

Top priority signals:
${signalLines}

Write a 3-4 sentence "What This Week Means" editorial synthesis. Requirements:
- Name the dominant theme or pattern across this week's signals
- Identify the single most important action for security and risk leaders this week
- Note any cross-domain pattern if one exists (e.g., where regulatory and technical risk converge)
- Write in a clear, direct editorial voice — not algorithmic, not bulleted
- Do not reference yourself or the brief format

Return plain text only.`;
}

/**
 * Analyze a single signal using the LLM.
 * Returns null if the API key is absent or the call fails.
 */
export async function analyzeSignal(
  title: string,
  content: string,
  category: string,
  source: string
): Promise<SignalAnalysis | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: buildSignalPrompt(title, content, category, source)
        }
      ]
    });

    const raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();

    // Strip markdown code fences if the model adds them despite instructions
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    const parsed = JSON.parse(cleaned) as Partial<SignalAnalysis>;

    if (!parsed.analysis || !parsed.whyItMatters || !parsed.recommendedAction) {
      logger.warn(
        { event: "llm_signal_incomplete", title },
        "LLM signal analysis returned incomplete fields — using template"
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
      "LLM signal analysis failed — using template"
    );
    return null;
  }
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
      model: "claude-haiku-4-5-20251001",
      max_tokens: 280,
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
      "LLM brief synthesis failed — using template headline"
    );
    return null;
  }
}
