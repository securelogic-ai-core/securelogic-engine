/**
 * predictiveNarrative.ts — ERIP E5b (Predictive Intelligence): the LLM-assisted
 * insight overlay on top of the deterministic forecasts (E5a). Uses the F1 LLM
 * service to turn the org's persisted forecasts into an executive narrative +
 * prioritized, grounded recommendations. Degrades to a deterministic narrative
 * whenever the LLM is unavailable or declines — the forecasts themselves are
 * always the ground truth (LLM is explanation, never a new number).
 *
 * Prompt-injection posture: the only content fed to the model is our OWN
 * structured forecast data (dimension/metric/trend/confidence) — no customer
 * free text — so the injection surface is minimal. The validator hard-checks
 * that every recommendation references a real forecast dimension.
 */

import { completeJson, llmAvailable, LLM_REASONING_MODEL, type LlmDeps } from "./llm/llmService.js";
import type { StoredForecast } from "./riskForecastStore.js";

export interface Recommendation {
  dimension: string;
  action: string;
  priority: "immediate" | "near_term" | "planned" | "watch";
  rationale: string;
}

export interface PredictiveInsights {
  source: "llm" | "deterministic";
  headline: string;
  narrative: string;
  recommendations: Recommendation[];
}

const PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);

/** Forecasts most worth acting on: increasing avg_risk, highest confidence×value. */
function rankForecasts(forecasts: readonly StoredForecast[]): StoredForecast[] {
  return [...forecasts]
    .filter((f) => f.metric === "avg_risk" && f.trend === "increasing")
    .sort((a, b) => b.confidence * b.projected_value - a.confidence * a.projected_value);
}

/**
 * The always-available deterministic narrative. Grounded, factual, and used
 * both as the no-LLM fallback and as the structured seed for the LLM prompt.
 */
export function buildDeterministicNarrative(forecasts: readonly StoredForecast[]): PredictiveInsights {
  const rising = rankForecasts(forecasts);
  const headline =
    rising.length === 0
      ? "No dimension is forecast to increase in risk over the horizon."
      : `${rising.length} dimension${rising.length > 1 ? "s are" : " is"} forecast to increase in risk; ${rising[0]!.dimension} leads.`;
  const narrative =
    rising.length === 0
      ? "Forecasts across all dimensions are stable or decreasing. Maintain current controls and re-evaluate as new history accrues."
      : rising
          .slice(0, 5)
          .map(
            (f) =>
              `${f.dimension}: average risk is projected to reach ${f.projected_value} (${f.method}, confidence ${f.confidence}%).`
          )
          .join(" ");
  const recommendations: Recommendation[] = rising.slice(0, 3).map((f) => ({
    dimension: f.dimension,
    action: `Review controls and open findings for ${f.dimension} before the projected increase materializes.`,
    priority: f.projected_value >= 80 ? "immediate" : f.projected_value >= 60 ? "near_term" : "planned",
    rationale: `Projected average risk ${f.projected_value} with ${f.confidence}% confidence (${f.method}).`
  }));
  return { source: "deterministic", headline, narrative, recommendations };
}

/** Validate the LLM's JSON against a strict shape; recommendations must be grounded. */
function validateInsights(raw: unknown, validDimensions: ReadonlySet<string>): Omit<PredictiveInsights, "source"> {
  const o = raw as { headline?: unknown; narrative?: unknown; recommendations?: unknown };
  if (typeof o.headline !== "string" || typeof o.narrative !== "string" || !Array.isArray(o.recommendations)) {
    throw new Error("insights shape mismatch");
  }
  const recommendations: Recommendation[] = [];
  for (const r of o.recommendations as unknown[]) {
    const rec = r as { dimension?: unknown; action?: unknown; priority?: unknown; rationale?: unknown };
    if (
      typeof rec.dimension !== "string" ||
      !validDimensions.has(rec.dimension) || // grounding: must be a real forecast dimension
      typeof rec.action !== "string" ||
      typeof rec.priority !== "string" ||
      !PRIORITIES.has(rec.priority) ||
      typeof rec.rationale !== "string"
    ) {
      continue; // drop ungrounded / malformed recommendations rather than fail the whole insight
    }
    recommendations.push({
      dimension: rec.dimension,
      action: rec.action.slice(0, 500),
      priority: rec.priority as Recommendation["priority"],
      rationale: rec.rationale.slice(0, 500)
    });
  }
  return { headline: o.headline.slice(0, 300), narrative: o.narrative.slice(0, 4000), recommendations };
}

const SYSTEM_PROMPT =
  "You are SecureLogic AI's executive risk analyst. You are given an organization's " +
  "risk forecasts (already computed by deterministic models). Write a concise, board-ready " +
  "executive narrative and prioritized recommendations. Ground every statement in the provided " +
  "forecasts — never invent numbers or dimensions. Recommendations must reference a dimension " +
  "present in the input. Respond with ONLY a JSON object: " +
  '{"headline": string, "narrative": string, "recommendations": [{"dimension": string, ' +
  '"action": string, "priority": "immediate"|"near_term"|"planned"|"watch", "rationale": string}]}.';

/**
 * Produce executive predictive insights. LLM-assisted when configured;
 * otherwise the deterministic narrative. Always grounded in the forecasts.
 */
export async function generatePredictiveInsights(
  forecasts: readonly StoredForecast[],
  deps: LlmDeps = {}
): Promise<PredictiveInsights> {
  const deterministic = buildDeterministicNarrative(forecasts);
  // Client explicitly null (tests) or no key → deterministic.
  if (deps.client === null || (deps.client === undefined && !llmAvailable())) return deterministic;

  const validDimensions = new Set(forecasts.map((f) => f.dimension));
  const facts = forecasts.map((f) => ({
    dimension: f.dimension,
    metric: f.metric,
    projected_value: f.projected_value,
    trend: f.trend,
    confidence: f.confidence,
    method: f.method,
    horizon_days: f.horizon_days
  }));

  const res = await completeJson(
    {
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Forecasts:\n${JSON.stringify(facts, null, 2)}` }],
      maxTokens: 1200,
      model: LLM_REASONING_MODEL
    },
    (raw) => validateInsights(raw, validDimensions),
    deps
  );

  if (!res.ok) return deterministic; // any LLM failure → deterministic (graceful)
  return { source: "llm", ...res.value };
}
