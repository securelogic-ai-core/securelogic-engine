/**
 * vendorAssuranceCuecMatcher.ts — promotes a document's extracted CUEC array
 * into vendor_assurance_cuecs rows and LLM-matches them against the customer's
 * controls inventory, writing 'suggested' rows into
 * vendor_assurance_cuec_control_mappings.
 *
 * WHY LLM, NOT EMBEDDINGS OR LEXICAL (v1 decision — see
 * docs/vendor-assurance-cuec-matching-design.md):
 *   - No embedding/pgvector infrastructure exists in the platform; building it
 *     (control-embedding pipeline + backfill) is a prerequisite package, not
 *     in scope here.
 *   - The existing lexical matcher (cyberSignalProcessingService) is ILIKE
 *     name-equality — useless for "long CUEC sentence → terse control name".
 *   - The shape (full CUEC statement → short control name/description) is what
 *     an LLM does well; cost is bounded (ONE call per document/pass with the
 *     full CUEC list + full active-controls list); calibration is a tunable
 *     prompt + an explainable per-match rationale.
 *
 * NEVER auto-accepts. Every produced mapping is 'suggested'; the reviewer
 * accepts/dismisses. A 'high confidence' band (score ≥ MATCH_SCORE_HIGH_
 * CONFIDENCE) is a UI hint only.
 *
 * IDEMPOTENCY:
 *   - syncCuecRowsForDocument: DELETE-then-INSERT vendor_assurance_cuecs from
 *     whatever the *effective* cuecs list is (latest cuecs field-override if
 *     one exists, else extraction.fields["cuecs"].value). Deleting cuec rows
 *     cascades their mappings — used when the cuec list itself changed.
 *   - runCuecMatcherForDocument: DELETE existing mapping_status='suggested'
 *     rows for the doc's cuecs (preserves 'accepted' / 'dismissed'), runs the
 *     LLM, INSERTs new suggestions with ON CONFLICT (cuec_id, control_id)
 *     DO NOTHING — so a previously-dismissed (or accepted) pair is never
 *     re-suggested. A run that hits an LLM-unavailable / LLM-failed / invalid-
 *     response condition leaves all existing mappings untouched.
 *
 * Tenant rule (TENANT_ISOLATION_STANDARD.md §6): one document's CUECs and one
 * org's controls per LLM call. Never batched across orgs.
 *
 * Runs in the engine API process (the vendor-assurance "worker" is the
 * in-process setImmediate task in vendorAssuranceExtractionRunner.ts) — NOT in
 * the intelligence-worker. Failure is non-fatal to extraction: the cuec rows
 * still get written; the suggestions just don't, and the Re-match button is
 * the recovery path.
 */

import Anthropic from "@anthropic-ai/sdk";
import { instrumentAnthropicClient } from "../infra/providerQuotaAlert.js";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

export const CUEC_MATCHER_PROMPT_VERSION = "cuec-matcher-v1";
export const CUEC_MATCHER_MODEL_ID = "claude-sonnet-4-6";

/** Below this score the matcher writes no suggestion row. Configurable. */
export const MATCH_SCORE_MIN_THRESHOLD = 60;
/** At/above this score the UI shows a "high confidence" hint — never auto-accepts. */
export const MATCH_SCORE_HIGH_CONFIDENCE = 85;

/** Cap on controls sent to the LLM in one call (alphabetical by name when over). */
export const CUEC_MATCHER_MAX_CONTROLS = 400;
/** Per-control description char budget in the prompt. */
const CONTROL_DESC_BUDGET = 400;
/** Per-CUEC text char budget in the prompt. */
const CUEC_TEXT_BUDGET = 1500;
/** Anthropic max_tokens for the matcher response. */
const MATCHER_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CuecRow = { id: string; ordinal: number; cuec_text: string };
export type ControlRow = { id: string; name: string; description: string | null };

export type CuecMatch = {
  cuec_ordinal: number;
  control_id: string;
  score: number;
  reasoning: string;
};

export type CuecMatcherLlmResult =
  | { ok: true; text: string }
  | { ok: false; code: "llm_unavailable" | "llm_failed"; detail: string };

export type CuecMatcherRunResult = {
  matched: boolean;
  /** Why the run did not produce suggestions, when matched === false. */
  reason?: "no_cuecs" | "no_controls" | "llm_unavailable" | "llm_failed" | "invalid_response";
  cuecCount: number;
  controlCount: number;
  /** Valid matches at/above MATCH_SCORE_MIN_THRESHOLD. */
  suggestionsConsidered: number;
  /** Rows actually INSERTed ('suggested'); pairs that already had any row are skipped. */
  suggestionsWritten: number;
};

type CuecMatcherLlmCall = (prompt: string) => Promise<CuecMatcherLlmResult>;

// ---------------------------------------------------------------------------
// Pure: effective cuec list extraction
// ---------------------------------------------------------------------------

/**
 * Given a raw `cuecs` value (extraction field value or override value), return
 * the normalized list of non-empty CUEC statements with stable ordinals
 * (0..n-1, contiguous). Non-array / non-string-element inputs yield [].
 */
export function normalizeCuecList(raw: unknown): Array<{ ordinal: number; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ ordinal: number; text: string }> = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text.length === 0) continue;
    out.push({ ordinal: out.length, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure: prompt builder
// ---------------------------------------------------------------------------

export function buildCuecMatcherPrompt(args: { cuecs: CuecRow[]; controls: ControlRow[] }): string {
  const cuecBlock = args.cuecs
    .map((c) => `  [cuec ${c.ordinal}] ${c.cuec_text.slice(0, CUEC_TEXT_BUDGET).replace(/\s+/g, " ").trim()}`)
    .join("\n");

  const controlBlock = args.controls
    .map((c) => {
      const name = c.name.replace(/\s+/g, " ").trim();
      const desc = (c.description ?? "").slice(0, CONTROL_DESC_BUDGET).replace(/\s+/g, " ").trim();
      return `  [control ${c.id}] ${name}${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");

  return `You are a senior third-party risk analyst mapping a SOC report's complementary user entity controls (CUECs) onto a customer's internal controls inventory.

A CUEC is a control statement the vendor's auditor says the *customer organization* is responsible for operating in order for the vendor's controls to be effective. Your job: for each CUEC below, identify which of the customer's controls (if any) satisfy that responsibility.

CUECs (each prefixed with its ordinal):
${cuecBlock}

Customer controls inventory (each prefixed with its control id — a UUID):
${controlBlock}

Rules:
- A CUEC may map to zero, one, or several customer controls. Many CUECs will have no good match — that is expected; do not force a match.
- Only include a mapping you are reasonably confident about. Use a 0-100 confidence score: ~40 = plausible but uncertain, ~60 = solid, ~85+ = clearly the right control.
- "control_id" MUST be one of the UUIDs listed above, copied verbatim. Do NOT invent ids. Do NOT map to a control that is not listed.
- "cuec_ordinal" MUST be one of the ordinals listed above.
- "reasoning" is one short sentence (≤ 200 chars) explaining the mapping.

Return valid JSON only — no markdown, no code fences, no commentary:
{
  "matches": [
    { "cuec_ordinal": <int>, "control_id": "<uuid from the list>", "score": <0-100 int>, "reasoning": "<short sentence>" }
  ]
}
If nothing maps, return { "matches": [] }.`;
}

// ---------------------------------------------------------------------------
// Pure: response validator (drops invalid entries; never throws)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function validateCuecMatcherResponse(
  raw: unknown,
  knownOrdinals: ReadonlySet<number>,
  knownControlIdsLower: ReadonlySet<string>
): { ok: true; matches: CuecMatch[]; droppedCount: number } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "response_not_object" };
  const arr = raw["matches"];
  if (!Array.isArray(arr)) return { ok: false, error: "matches_not_array" };

  const out: CuecMatch[] = [];
  let dropped = 0;
  const seenPairs = new Set<string>();
  for (const m of arr) {
    if (!isPlainObject(m)) { dropped++; continue; }
    const ord = m["cuec_ordinal"];
    const cid = m["control_id"];
    const sc = m["score"];
    if (typeof ord !== "number" || !Number.isInteger(ord) || !knownOrdinals.has(ord)) { dropped++; continue; }
    if (typeof cid !== "string" || !knownControlIdsLower.has(cid.trim().toLowerCase())) { dropped++; continue; }
    if (typeof sc !== "number" || !Number.isFinite(sc)) { dropped++; continue; }
    const score = Math.max(0, Math.min(100, Math.round(sc)));
    const controlId = cid.trim().toLowerCase();
    const pairKey = `${ord}::${controlId}`;
    if (seenPairs.has(pairKey)) { dropped++; continue; }   // de-dup repeated pairs in the response
    seenPairs.add(pairKey);
    const reasoning =
      typeof m["reasoning"] === "string" ? (m["reasoning"] as string).slice(0, 300).trim() : "";
    out.push({ cuec_ordinal: ord, control_id: controlId, score, reasoning });
  }
  return { ok: true, matches: out, droppedCount: dropped };
}

// ---------------------------------------------------------------------------
// LLM call (real implementation; injectable in tests)
// ---------------------------------------------------------------------------

function getClient(): Anthropic | null {
  const key = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key }));
}

async function defaultCuecMatcherLlmCall(prompt: string): Promise<CuecMatcherLlmResult> {
  const client = getClient();
  if (client === null) {
    return { ok: false, code: "llm_unavailable", detail: "ANTHROPIC_API_KEY not set" };
  }
  try {
    const message = await client.messages.create({
      model: CUEC_MATCHER_MODEL_ID,
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
// syncCuecRowsForDocument — (re)build vendor_assurance_cuecs from the effective list
// ---------------------------------------------------------------------------

/**
 * Read the document's effective cuecs list (latest `cuecs` field-override if
 * present, else extraction.fields["cuecs"].value), then DELETE-then-INSERT the
 * vendor_assurance_cuecs rows for the document. Deleting cuec rows cascades
 * their mappings — call this only when the cuec list itself may have changed
 * (first extraction, or a `cuecs` field override). Idempotent.
 */
export async function syncCuecRowsForDocument(
  documentId: string,
  organizationId: string
): Promise<{ cuecCount: number }> {
  // Reads + the DELETE-then-INSERT write run in ONE tenant scope. There is no
  // external I/O between them, so a single withTenant transaction is correct;
  // pg.connect() inside the scope auto-returns a savepoint client, so the
  // BEGIN/COMMIT/ROLLBACK block below is unchanged.
  return await withTenant(organizationId, async () => {
    // Effective list: latest cuecs override wins over the extraction value.
    const overrideRes = await pg.query<{ override_value: unknown }>(
      `SELECT override_value FROM vendor_assurance_field_overrides
        WHERE document_id = $1 AND organization_id = $2 AND field_name = 'cuecs'
        ORDER BY overridden_at DESC, id DESC
        LIMIT 1`,
      [documentId, organizationId]
    );

    let rawCuecs: unknown;
    if ((overrideRes.rowCount ?? 0) > 0) {
      rawCuecs = overrideRes.rows[0]!.override_value;
    } else {
      const extRes = await pg.query<{ fields: Record<string, { value?: unknown }> | null }>(
        `SELECT fields FROM vendor_assurance_extractions
          WHERE document_id = $1 AND organization_id = $2
          LIMIT 1`,
        [documentId, organizationId]
      );
      rawCuecs = (extRes.rows[0]?.fields ?? {})["cuecs"]?.value ?? null;
    }

    const normalized = normalizeCuecList(rawCuecs);

    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM vendor_assurance_cuecs WHERE document_id = $1 AND organization_id = $2`,
        [documentId, organizationId]
      );
      if (normalized.length > 0) {
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let p = 1;
        for (const c of normalized) {
          placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
          values.push(organizationId, documentId, c.ordinal, c.text);
        }
        await client.query(
          `INSERT INTO vendor_assurance_cuecs (organization_id, document_id, ordinal, cuec_text)
           VALUES ${placeholders.join(", ")}`,
          values
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }

    return { cuecCount: normalized.length };
  });
}

// ---------------------------------------------------------------------------
// runCuecMatcherForDocument — LLM-match the doc's cuecs against active controls
// ---------------------------------------------------------------------------

export async function runCuecMatcherForDocument(
  documentId: string,
  organizationId: string,
  opts?: { llmCall?: CuecMatcherLlmCall }
): Promise<CuecMatcherRunResult> {
  const llmCall = opts?.llmCall ?? defaultCuecMatcherLlmCall;

  // ── Phase 1 (DB reads) ──────────────────────────────────────────────────
  // The two SELECTs and the no-controls cleanup DELETE run in ONE short tenant
  // scope that CLOSES before the LLM call below — no tenant transaction is held
  // across the network round-trip. The scope returns a discriminated result:
  // either an early `done` outcome (no cuecs / no controls) or the `proceed`
  // bundle the LLM + write phases need.
  type Phase1Result =
    | { done: CuecMatcherRunResult }
    | {
        proceed: {
          cuecs: CuecRow[];
          cuecIds: string[];
          cuecIdByOrdinal: Map<number, string>;
          knownOrdinals: Set<number>;
          controls: ControlRow[];
          knownControlIdsLower: Set<string>;
        };
      };

  const phase1 = await withTenant(organizationId, async (): Promise<Phase1Result> => {
    const cuecRes = await pg.query<CuecRow>(
      `SELECT id, ordinal, cuec_text FROM vendor_assurance_cuecs
        WHERE document_id = $1 AND organization_id = $2
        ORDER BY ordinal ASC`,
      [documentId, organizationId]
    );
    const cuecs = cuecRes.rows;
    if (cuecs.length === 0) {
      return { done: { matched: false, reason: "no_cuecs", cuecCount: 0, controlCount: 0, suggestionsConsidered: 0, suggestionsWritten: 0 } };
    }
    const cuecIds = cuecs.map((c) => c.id);
    const cuecIdByOrdinal = new Map<number, string>(cuecs.map((c) => [c.ordinal, c.id]));
    const knownOrdinals = new Set<number>(cuecs.map((c) => c.ordinal));

    const ctlRes = await pg.query<ControlRow>(
      `SELECT id, name, description FROM controls
        WHERE organization_id = $1 AND status = 'active'
        ORDER BY name ASC
        LIMIT $2`,
      [organizationId, CUEC_MATCHER_MAX_CONTROLS]
    );
    const controls = ctlRes.rows;
    if (controls.length === 0) {
      // No inventory to match against — clear any stale suggestions, leave user actions.
      await pg.query(
        `DELETE FROM vendor_assurance_cuec_control_mappings
          WHERE cuec_id = ANY($1::uuid[]) AND mapping_status = 'suggested' AND organization_id = $2`,
        [cuecIds, organizationId]
      );
      return { done: { matched: false, reason: "no_controls", cuecCount: cuecs.length, controlCount: 0, suggestionsConsidered: 0, suggestionsWritten: 0 } };
    }
    const knownControlIdsLower = new Set<string>(controls.map((c) => c.id.toLowerCase()));

    return { proceed: { cuecs, cuecIds, cuecIdByOrdinal, knownOrdinals, controls, knownControlIdsLower } };
  });

  if ("done" in phase1) {
    return phase1.done;
  }
  const { cuecs, cuecIds, cuecIdByOrdinal, knownOrdinals, controls, knownControlIdsLower } = phase1.proceed;

  logger.info(
    { event: "cuec_matcher_llm_call_start", organizationId, documentId, cuecCount: cuecs.length, controlCount: controls.length, model: CUEC_MATCHER_MODEL_ID, prompt_version: CUEC_MATCHER_PROMPT_VERSION },
    "CUEC matcher LLM call"
  );

  const prompt = buildCuecMatcherPrompt({ cuecs, controls });
  const llm = await llmCall(prompt);
  if (!llm.ok) {
    logger.warn(
      { event: "cuec_matcher_llm_unavailable_or_failed", organizationId, documentId, code: llm.code, detail: llm.detail },
      "CUEC matcher: LLM unavailable/failed — existing mappings untouched"
    );
    return { matched: false, reason: llm.code, cuecCount: cuecs.length, controlCount: controls.length, suggestionsConsidered: 0, suggestionsWritten: 0 };
  }

  let parsed: unknown;
  try {
    const cleaned = llm.text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn({ event: "cuec_matcher_invalid_json", organizationId, documentId }, "CUEC matcher: response did not JSON-parse — existing mappings untouched");
    return { matched: false, reason: "invalid_response", cuecCount: cuecs.length, controlCount: controls.length, suggestionsConsidered: 0, suggestionsWritten: 0 };
  }
  const validated = validateCuecMatcherResponse(parsed, knownOrdinals, knownControlIdsLower);
  if (!validated.ok) {
    logger.warn({ event: "cuec_matcher_invalid_shape", organizationId, documentId, error: validated.error }, "CUEC matcher: response shape invalid — existing mappings untouched");
    return { matched: false, reason: "invalid_response", cuecCount: cuecs.length, controlCount: controls.length, suggestionsConsidered: 0, suggestionsWritten: 0 };
  }
  if (validated.droppedCount > 0) {
    logger.warn({ event: "cuec_matcher_dropped_entries", organizationId, documentId, dropped: validated.droppedCount }, "CUEC matcher: dropped invalid match entries");
  }

  const suggestions = validated.matches.filter((m) => m.score >= MATCH_SCORE_MIN_THRESHOLD);

  // ── Phase 3 (DB write) ──────────────────────────────────────────────────
  // Opened only AFTER the LLM has returned. pg.connect() inside the scope
  // auto-returns a savepoint client, so the BEGIN/COMMIT/ROLLBACK block is
  // unchanged. The insert count escapes the scope as the return value.
  const written = await withTenant(organizationId, async () => {
    let insertedCount = 0;
    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      // Drop stale auto-suggestions; preserve 'accepted' and 'dismissed' user actions.
      await client.query(
        `DELETE FROM vendor_assurance_cuec_control_mappings
          WHERE cuec_id = ANY($1::uuid[]) AND mapping_status = 'suggested' AND organization_id = $2`,
        [cuecIds, organizationId]
      );
      for (const m of suggestions) {
        const cuecId = cuecIdByOrdinal.get(m.cuec_ordinal);
        if (!cuecId) continue; // belt & suspenders — validator already checked
        const ins = await client.query<{ id: string }>(
          `INSERT INTO vendor_assurance_cuec_control_mappings
             (organization_id, cuec_id, control_id, mapping_status, mapping_score, mapping_source, reason, created_by_user_id, updated_by_user_id)
           VALUES ($1, $2, $3, 'suggested', $4, 'auto', NULL, NULL, NULL)
           ON CONFLICT (cuec_id, control_id) DO NOTHING
           RETURNING id`,
          [organizationId, cuecId, m.control_id, m.score]
        );
        if ((ins.rowCount ?? 0) > 0) insertedCount++;
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
    return insertedCount;
  });

  logger.info(
    { event: "cuec_matcher_complete", organizationId, documentId, cuecCount: cuecs.length, controlCount: controls.length, considered: suggestions.length, written },
    "CUEC matcher complete"
  );

  return {
    matched: true,
    cuecCount: cuecs.length,
    controlCount: controls.length,
    suggestionsConsidered: suggestions.length,
    suggestionsWritten: written
  };
}

// ---------------------------------------------------------------------------
// refreshCuecMappingsForDocument — orchestration entry point
// ---------------------------------------------------------------------------

/**
 * Used by the extraction runner (resyncRows: true, first run), the cuecs
 * field-override re-trigger (resyncRows: true), and the manual Re-match route
 * (resyncRows: false). When resyncRows is true the cuec rows (and, via cascade,
 * all their mappings) are rebuilt first — appropriate when the cuec list itself
 * may have changed.
 */
export async function refreshCuecMappingsForDocument(
  documentId: string,
  organizationId: string,
  opts: { resyncRows: boolean; llmCall?: CuecMatcherLlmCall }
): Promise<CuecMatcherRunResult> {
  if (opts.resyncRows) {
    await syncCuecRowsForDocument(documentId, organizationId);
  }
  return runCuecMatcherForDocument(
    documentId,
    organizationId,
    opts.llmCall ? { llmCall: opts.llmCall } : undefined
  );
}
