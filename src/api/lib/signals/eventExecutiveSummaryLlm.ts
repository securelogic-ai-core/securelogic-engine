/**
 * eventExecutiveSummaryLlm.ts — optional LLM narrative overlay for the canonical
 * event executive summary. Intelligence Pipeline Hardening / IE.P5.
 *
 * Asks the shared LLM service for a richer 2-3 sentence analyst briefing grounded
 * ONLY in the structured event facts, and falls back to the deterministic
 * buildEventSummary() on any LLM unavailability / failure / refusal — the same
 * graceful-degradation discipline as the ERIP raised-bar LLM features. Never
 * throws, and is NEVER called inside the projection DB transaction (no network
 * I/O under a lock). Kept in its own module so the Anthropic SDK stays out of the
 * pure projection core.
 */

import { assessContent } from "./contentQuality.js";
import {
  buildEventSummary,
  prettifySource,
  summaryCitation,
  ensureTerminated,
  type EventSummaryInput
} from "./eventExecutiveSummary.js";
import { completeText, type LlmDeps } from "../llm/llmService.js";

export async function enhanceEventSummaryLLM(
  input: EventSummaryInput,
  deps: LlmDeps = {}
): Promise<{ summary: string; enhanced: boolean }> {
  const deterministic = buildEventSummary(input);

  const system =
    "You are a cybersecurity intelligence analyst writing a 2-3 sentence executive " +
    "briefing. Use ONLY the structured facts provided. Do not invent CVEs, vendors, " +
    "dates, or exploitation claims. Preserve the source attribution. Return prose only.";
  const facts = [
    `Title: ${input.title}`,
    `Severity: ${input.severity}`,
    `Status: ${input.status}`,
    input.affected_cve ? `CVE: ${input.affected_cve}` : null,
    input.affected_vendor ? `Vendor: ${input.affected_vendor}` : null,
    `Sources: ${input.sources.map(prettifySource).join(", ")}`,
    `Baseline: ${deterministic.summary}`
  ]
    .filter(Boolean)
    .join("\n");

  const res = await completeText(
    { system, messages: [{ role: "user", content: facts }], maxTokens: 300 },
    deps
  );

  if (res.ok) {
    const cleaned = assessContent(res.text);
    if (cleaned.status !== "degraded" && cleaned.displayText !== "") {
      const cite = summaryCitation(input.sources);
      const summary =
        cite && !cleaned.displayText.includes("Sources:")
          ? `${ensureTerminated(cleaned.displayText)} ${cite}`
          : cleaned.displayText;
      return { summary, enhanced: true };
    }
  }
  return { summary: deterministic.summary, enhanced: false };
}
