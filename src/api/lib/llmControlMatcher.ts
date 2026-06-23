/**
 * llmControlMatcher.ts — GAP-1 completion: signal → control matching via LLM.
 *
 * The deterministic signal→control branch was removed from the matcher because
 * token overlap cannot bridge CVE-feed vocabulary ("OpenSSL RCE") to control
 * names ("Patch & vulnerability management"). This rebuilds it as a cost-bounded
 * LLM classifier (separate package, mirrors vendorAssuranceCuecMatcher.ts).
 *
 * SUGGEST-ONLY: writes signal_match_suggestions (target_type 'control', already
 * allowed by the CHECK — NO migration) for human review. Never findings/risk.
 *
 * COST BOUNDS (this is an LLM call — the engine has a history of credit
 * exhaustion, so the gating is deliberately strict):
 *   - OFF by default behind SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED.
 *   - ONE LLM call per signal (all controls in a single prompt).
 *   - Only relevant signal types (vuln/threat — controls don't relate to a
 *     regulatory_change; obligations handle those).
 *   - Only Critical/High severity (the matches worth a human's time + the spend).
 *   - Controls capped (MAX_CONTROLS) so the prompt stays bounded.
 *   - No-ops cheaply (returns before any spend) when gated off or no API key.
 *
 * ARCHITECTURE: runLlmControlMatcherForSignal is called AFTER the matcher's
 * transaction commits (LLM latency must never block the fast per-signal matcher)
 * and is fully self-contained + error-swallowing.
 *
 * Pure functions (prompt/validator) are exported and unit-tested; the LLM call
 * is injectable.
 */

import Anthropic from "@anthropic-ai/sdk";
import { instrumentAnthropicClient } from "../infra/providerQuotaAlert.js";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

export const LLM_CONTROL_MATCHER_MODEL_ID = "claude-sonnet-4-6";
export const LLM_CONTROL_MATCHER_PROMPT_VERSION = "control-matcher-v1";

/** Min LLM confidence (0-100) to write a suggestion. */
export const CONTROL_MATCH_MIN_SCORE = 50;
/** Max suggestions written per signal. */
export const CONTROL_SUGGESTION_CAP = 8;
/** Max controls included in the prompt (bounds tokens/cost). */
export const MAX_CONTROLS_IN_PROMPT = 80;

const CONTROL_DESC_BUDGET = 280;
const SIGNAL_SUMMARY_BUDGET = 1200;
const MATCHER_MAX_TOKENS = 1024;

/** Signal types worth an LLM control-mapping spend (vuln/threat surface). */
export const CONTROL_RELEVANT_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  "cve", "patch", "patch_advisory", "threat_actor", "malware", "vulnerability", "advisory"
]);

export type ControlRow = { id: string; name: string; description: string | null };

export type ControlMatch = { control_id: string; score: number; reasoning: string };

export type LlmCallResult =
  | { ok: true; text: string }
  | { ok: false; code: "llm_unavailable" | "llm_failed"; detail: string };

export type SignalForControlMatch = {
  id: string;
  signal_type: string;
  severity: string;
  normalized_summary: string;
};

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------

export function llmControlMatcherEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED"] === "true";
}

// ---------------------------------------------------------------------------
// Pure: prompt builder
// ---------------------------------------------------------------------------

export function buildControlMatcherPrompt(args: {
  signal: { signal_type: string; severity: string; normalized_summary: string };
  controls: ControlRow[];
}): string {
  const summary = args.signal.normalized_summary
    .slice(0, SIGNAL_SUMMARY_BUDGET)
    .replace(/\s+/g, " ")
    .trim();

  const controlBlock = args.controls
    .map((c) => {
      const name = c.name.replace(/\s+/g, " ").trim();
      const desc = (c.description ?? "").slice(0, CONTROL_DESC_BUDGET).replace(/\s+/g, " ").trim();
      return `  [control ${c.id}] ${name}${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");

  return `You are a security analyst mapping an external cyber signal onto a customer's internal controls inventory. Identify which of the customer's controls (if any) the customer should REVIEW or VERIFY in response to this signal.

Signal (type: ${args.signal.signal_type}, severity: ${args.signal.severity}):
${summary}

Customer controls inventory (each prefixed with its control id — a UUID):
${controlBlock}

Rules:
- A signal may map to zero, one, or several controls. Many signals will have no good match — that is expected; do NOT force a match.
- Map a control only if acting on / verifying it is a sensible response to THIS signal (e.g. a patch-management control for a CVE, an access-control for a credential-theft campaign).
- Use a 0-100 confidence score: ~40 = plausible, ~60 = solid, ~85+ = clearly the right control.
- "control_id" MUST be one of the UUIDs listed above, copied verbatim. Do NOT invent ids or map to a control not listed.
- "reasoning" is one short sentence (<= 200 chars).

Return valid JSON only — no markdown, no code fences, no commentary:
{ "matches": [ { "control_id": "<uuid from the list>", "score": <0-100 int>, "reasoning": "<short sentence>" } ] }
If nothing maps, return { "matches": [] }.`;
}

// ---------------------------------------------------------------------------
// Pure: response validator (drops invalid entries; never throws)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Strip markdown code fences an LLM may wrap JSON in. */
export function stripJsonFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

export function validateControlMatcherResponse(
  raw: unknown,
  knownControlIdsLower: ReadonlySet<string>
): { ok: true; matches: ControlMatch[]; droppedCount: number } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "response_not_object" };
  const arr = raw["matches"];
  if (!Array.isArray(arr)) return { ok: false, error: "matches_not_array" };

  const out: ControlMatch[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const m of arr) {
    if (!isPlainObject(m)) { dropped++; continue; }
    const cid = m["control_id"];
    const sc = m["score"];
    if (typeof cid !== "string" || !knownControlIdsLower.has(cid.trim().toLowerCase())) { dropped++; continue; }
    if (typeof sc !== "number" || !Number.isFinite(sc)) { dropped++; continue; }
    const controlId = cid.trim().toLowerCase();
    if (seen.has(controlId)) { dropped++; continue; }
    seen.add(controlId);
    const score = Math.max(0, Math.min(100, Math.round(sc)));
    const reasoning =
      typeof m["reasoning"] === "string" ? (m["reasoning"] as string).slice(0, 300).trim() : "";
    out.push({ control_id: controlId, score, reasoning });
  }
  return { ok: true, matches: out, droppedCount: dropped };
}

// ---------------------------------------------------------------------------
// LLM call (real; injectable in tests)
// ---------------------------------------------------------------------------

function getClient(): Anthropic | null {
  const key = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key }));
}

async function defaultLlmCall(prompt: string): Promise<LlmCallResult> {
  const client = getClient();
  if (client === null) return { ok: false, code: "llm_unavailable", detail: "ANTHROPIC_API_KEY not set" };
  try {
    const message = await client.messages.create({
      model: LLM_CONTROL_MATCHER_MODEL_ID,
      max_tokens: MATCHER_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }]
    });
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();
    return { ok: true, text };
  } catch (err) {
    return { ok: false, code: "llm_failed", detail: (err as Error)?.message ?? "anthropic call failed" };
  }
}

// ---------------------------------------------------------------------------
// shouldRunControlMatcher — the cheap cost gate (pure)
// ---------------------------------------------------------------------------

/** Returns true only when this signal is worth an LLM control-mapping spend. */
export function shouldRunControlMatcher(
  signal: SignalForControlMatch,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    llmControlMatcherEnabled(env) &&
    CONTROL_RELEVANT_SIGNAL_TYPES.has(signal.signal_type) &&
    (signal.severity === "Critical" || signal.severity === "High")
  );
}

// ---------------------------------------------------------------------------
// runLlmControlMatcherForSignal — I/O (self-contained, error-swallowing)
// ---------------------------------------------------------------------------

/**
 * Suggest controls relevant to a signal, for one org. Call AFTER the matcher tx
 * commits. No-ops cheaply when gated off / no controls. NEVER throws (a control-
 * suggestion failure must not affect signal processing).
 *
 * @returns number of suggestions written (0 when gated off or no match).
 */
export async function runLlmControlMatcherForSignal(
  signal: SignalForControlMatch,
  orgId: string,
  llmCall: (prompt: string) => Promise<LlmCallResult> = defaultLlmCall
): Promise<number> {
  if (!shouldRunControlMatcher(signal)) return 0;

  try {
    return await withTenant(orgId, async () => {
      const controlsResult = await pg.query<ControlRow>(
        `SELECT id, name, description FROM controls WHERE organization_id = $1 ORDER BY created_at ASC LIMIT $2`,
        [orgId, MAX_CONTROLS_IN_PROMPT]
      );
      const controls = controlsResult.rows;
      if (controls.length === 0) return 0;

      const prompt = buildControlMatcherPrompt({ signal, controls });
      logger.info(
        { event: "llm_control_matcher_start", orgId, signalId: signal.id, controlCount: controls.length, model: LLM_CONTROL_MATCHER_MODEL_ID },
        "LLM control matcher: calling"
      );

      const result = await llmCall(prompt);
      if (!result.ok) {
        logger.warn({ event: "llm_control_matcher_call_failed", orgId, signalId: signal.id, code: result.code }, "LLM control matcher: call failed — no suggestions");
        return 0;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonFences(result.text));
      } catch {
        logger.warn({ event: "llm_control_matcher_invalid_json", orgId, signalId: signal.id }, "LLM control matcher: response did not JSON-parse");
        return 0;
      }

      const knownIds = new Set(controls.map((c) => c.id.toLowerCase()));
      const validated = validateControlMatcherResponse(parsed, knownIds);
      if (!validated.ok) {
        logger.warn({ event: "llm_control_matcher_invalid_shape", orgId, signalId: signal.id, error: validated.error }, "LLM control matcher: invalid response shape");
        return 0;
      }

      const toWrite = validated.matches
        .filter((m) => m.score >= CONTROL_MATCH_MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, CONTROL_SUGGESTION_CAP);

      let written = 0;
      for (const m of toWrite) {
        const ins = await pg.query<{ id: string }>(
          `
          INSERT INTO signal_match_suggestions (
            organization_id, signal_id, target_type, target_id,
            match_reason, match_score, match_metadata
          )
          VALUES ($1, $2::uuid, 'control', $3::uuid, 'control_llm_match', $4, $5::jsonb)
          ON CONFLICT (organization_id, signal_id, target_type, target_id)
            WHERE accepted_at IS NULL AND dismissed_at IS NULL
            DO NOTHING
          RETURNING id
          `,
          [
            orgId,
            signal.id,
            m.control_id,
            m.score,
            JSON.stringify({
              source: "llm",
              matched_branch: "control_llm",
              model: LLM_CONTROL_MATCHER_MODEL_ID,
              prompt_version: LLM_CONTROL_MATCHER_PROMPT_VERSION,
              reasoning: m.reasoning
            })
          ]
        );
        if ((ins.rowCount ?? 0) > 0) written++;
      }

      logger.info(
        { event: "llm_control_matcher_done", orgId, signalId: signal.id, candidates: validated.matches.length, written },
        "LLM control matcher: wrote control suggestions"
      );
      return written;
    });
  } catch (err) {
    logger.warn({ event: "llm_control_matcher_failed", orgId, signalId: signal.id, err }, "LLM control matcher failed (non-fatal)");
    return 0;
  }
}
