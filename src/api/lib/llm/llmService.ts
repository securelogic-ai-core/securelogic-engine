/**
 * llmService.ts — ERIP shared LLM service (F1).
 *
 * One canonical wrapper over the Anthropic client for every ERIP LLM feature:
 * predictive narrative/prioritization (E5), autonomous prioritization (E6), and
 * knowledge-graph natural-language querying/reasoning (E7). Reuses the codebase
 * conventions verbatim:
 *   - `instrumentAnthropicClient(new Anthropic({ apiKey }))` (providerQuotaAlert)
 *     — same construction as llmControlMatcher / claudeAssessmentAnalyzer.
 *   - Graceful degradation: no `ANTHROPIC_API_KEY` → a typed `llm_unavailable`
 *     result, never a throw. Callers degrade (serve without the LLM overlay).
 *   - Injectable client so tests use a fake, never the network.
 *
 * The real model is `claude-sonnet-4-6` (the reasoning model the LLM control
 * matcher already uses in production) for reasoning tasks, and
 * `claude-haiku-4-5` for cheap extraction. Bounded `max_tokens`; no sampling
 * params (removed on 4.6+). Every call is org-attributable by the caller's log.
 */

import Anthropic from "@anthropic-ai/sdk";
import { instrumentAnthropicClient } from "../../infra/providerQuotaAlert.js";

/** Reasoning model for narrative / prioritization / NL-to-query. */
export const LLM_REASONING_MODEL = "claude-sonnet-4-6";
/** Cheap model for bounded extraction / classification. */
export const LLM_FAST_MODEL = "claude-haiku-4-5";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCompleteOptions {
  system?: string;
  messages: LlmMessage[];
  maxTokens: number;
  model?: string;
}

export type LlmResult =
  | { ok: true; text: string; model: string }
  | { ok: false; code: "llm_unavailable" | "llm_failed" | "llm_refused"; detail?: string };

/** Minimal injectable surface — a fake satisfies it in tests; prod = the SDK. */
export interface RawLlmClient {
  messages: {
    create: (args: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>;
      stop_reason?: string | null;
      model?: string;
    }>;
  };
}

export interface LlmDeps {
  client?: RawLlmClient | null;
}

/** Build the production client, or null when no key is configured. */
function defaultClient(): RawLlmClient | null {
  const key = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key })) as unknown as RawLlmClient;
}

/**
 * One completion call. Never throws — returns a typed result the caller can
 * degrade on. `llm_refused` is surfaced distinctly so callers don't retry a
 * safety decline.
 */
export async function completeText(options: LlmCompleteOptions, deps: LlmDeps = {}): Promise<LlmResult> {
  const client = deps.client !== undefined ? deps.client : defaultClient();
  if (client === null) return { ok: false, code: "llm_unavailable", detail: "ANTHROPIC_API_KEY not set" };

  const model = options.model ?? LLM_REASONING_MODEL;
  try {
    const message = await client.messages.create({
      model,
      max_tokens: options.maxTokens,
      ...(options.system ? { system: options.system } : {}),
      messages: options.messages.map((m) => ({ role: m.role, content: m.content }))
    });
    if (message.stop_reason === "refusal") {
      return { ok: false, code: "llm_refused", detail: "safety classifier declined the request" };
    }
    const text = (message.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("")
      .trim();
    if (text.length === 0) return { ok: false, code: "llm_failed", detail: "empty completion" };
    return { ok: true, text, model: message.model ?? model };
  } catch (err) {
    return { ok: false, code: "llm_failed", detail: (err as Error)?.message ?? "anthropic call failed" };
  }
}

export type LlmJsonResult<T> =
  | { ok: true; value: T; model: string }
  | { ok: false; code: "llm_unavailable" | "llm_failed" | "llm_refused" | "llm_invalid_json"; detail?: string };

/**
 * Extract the first balanced top-level JSON object/array from a completion —
 * tolerant of ```json fences and surrounding prose (the model-agnostic pattern
 * the codebase's Claude analyzers already use).
 */
export function extractJson(text: string): string | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1]! : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Completion constrained to JSON. The caller supplies a `validate` that parses
 * the raw object into a typed value (throwing on shape mismatch). Returns a
 * typed result; malformed or unvalidatable JSON degrades to `llm_invalid_json`.
 */
export async function completeJson<T>(
  options: LlmCompleteOptions,
  validate: (raw: unknown) => T,
  deps: LlmDeps = {}
): Promise<LlmJsonResult<T>> {
  const res = await completeText(options, deps);
  if (!res.ok) return res;
  const jsonText = extractJson(res.text);
  if (jsonText === null) return { ok: false, code: "llm_invalid_json", detail: "no JSON found in completion" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, code: "llm_invalid_json", detail: "JSON.parse failed" };
  }
  try {
    return { ok: true, value: validate(parsed), model: res.model };
  } catch (err) {
    return { ok: false, code: "llm_invalid_json", detail: (err as Error)?.message ?? "validation failed" };
  }
}

/** True when an LLM is configured — lets callers pick an LLM vs. deterministic path. */
export function llmAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env["ANTHROPIC_API_KEY"]?.trim().length ?? 0) > 0;
}
