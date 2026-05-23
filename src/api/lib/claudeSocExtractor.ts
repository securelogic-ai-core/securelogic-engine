/**
 * claudeSocExtractor.ts — Anthropic Sonnet call for SOC field extraction.
 *
 * Tenant rule (TENANT_ISOLATION_STANDARD.md §6):
 *   The prompt contains exactly ONE document's text, scoped to ONE
 *   organizationId. No batching across orgs.
 *
 * Logs at every call: { organizationId, model, prompt_version, purpose }.
 *
 * Returns a discriminated result so the runner can record the precise
 * extraction_failed:* error code:
 *   - { ok: true, fields, spans, rawExcerpt }
 *   - { ok: false, errorCode, detail, rawExcerpt? } — rawExcerpt is present on
 *     the two llm_invalid_json paths (JSON.parse error and validator rejection)
 *     so the failure is diagnosable without re-running the LLM call. It is
 *     absent for llm_unavailable and llm_failed, where no response was received.
 */

import Anthropic from "@anthropic-ai/sdk";
import { instrumentAnthropicClient } from "../infra/providerQuotaAlert.js";
import { logger } from "../infra/logger.js";
import { buildSocExtractionPrompt, MODEL_ID, PROMPT_VERSION } from "./socExtractionPrompt.js";
import { validateSocExtraction, type ValidatedExtraction } from "./socExtractionValidator.js";

export const RAW_EXCERPT_BYTES = 8 * 1024;

export type SocExtractionResult =
  | {
      ok: true;
      fields: ValidatedExtraction["fields"];
      spans: ValidatedExtraction["spans"];
      rawExcerpt: string;
      modelId: string;
      promptVersion: string;
    }
  | {
      ok: false;
      errorCode: "llm_unavailable" | "llm_invalid_json" | "llm_failed";
      detail: string;
      /**
       * The raw model response, truncated to RAW_EXCERPT_BYTES. Present only on
       * the two llm_invalid_json paths (a response was received but did not
       * parse / did not validate). Absent for llm_unavailable and llm_failed.
       */
      rawExcerpt?: string;
    };

function getClient(): Anthropic | null {
  const key = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key }));
}

export async function runSocExtraction(args: {
  organizationId: string;
  documentText: string;
  documentTypeHint: string | null;
}): Promise<SocExtractionResult> {
  const client = getClient();
  if (client === null) {
    logger.warn(
      {
        event: "vendor_assurance_llm_unavailable",
        purpose: "soc_extraction",
        organizationId: args.organizationId
      },
      "ANTHROPIC_API_KEY absent — extraction marked llm_unavailable"
    );
    return { ok: false, errorCode: "llm_unavailable", detail: "ANTHROPIC_API_KEY not set" };
  }

  logger.info(
    {
      event: "llm_call_start",
      purpose: "soc_extraction",
      organizationId: args.organizationId,
      model: MODEL_ID,
      prompt_version: PROMPT_VERSION
    },
    "LLM call: SOC extraction"
  );

  const prompt = buildSocExtractionPrompt({
    documentText: args.documentText,
    documentTypeHint: args.documentTypeHint
  });

  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }]
    });
    raw = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("")
      .trim();
  } catch (err) {
    const detail = (err as Error)?.message ?? "anthropic call failed";
    logger.warn(
      {
        event: "vendor_assurance_llm_failed",
        purpose: "soc_extraction",
        organizationId: args.organizationId,
        err: detail
      },
      "SOC extraction Anthropic call failed"
    );
    return { ok: false, errorCode: "llm_failed", detail };
  }

  const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const rawExcerpt = raw.slice(0, RAW_EXCERPT_BYTES);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const detail = (err as Error)?.message ?? "JSON.parse failed";
    return { ok: false, errorCode: "llm_invalid_json", detail, rawExcerpt };
  }

  const validation = validateSocExtraction(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      errorCode: "llm_invalid_json",
      detail: validation.detail ? `${validation.error}: ${validation.detail}` : validation.error,
      rawExcerpt
    };
  }

  return {
    ok: true,
    fields: validation.extraction.fields,
    spans: validation.extraction.spans,
    rawExcerpt,
    modelId: MODEL_ID,
    promptVersion: PROMPT_VERSION
  };
}
