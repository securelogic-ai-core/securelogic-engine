/**
 * questionContent.ts — the closed vocabularies, canonical form and content
 * hash of a vendor-facing question version (VA-Q1 / ADR-0013 R1, R3).
 *
 * The hash is the identity an issued questionnaire is addressed by, so it is
 * computed in exactly ONE place and the database checks only its shape. Two
 * independent callers — the publish route now, the snapshot hash (P2) and the
 * bridge equivalence proof (P3) later — must agree byte-for-byte, and the way
 * to guarantee that is to give them nothing to disagree about.
 *
 * Canonicalisation rules, all deliberate:
 *   - keys in a fixed order, not JSON.stringify's insertion order;
 *   - `guidance` absent and `guidance: null` hash identically (both mean "no
 *     guidance"); an empty string is normalised to null for the same reason;
 *   - prompt/guidance are trimmed — trailing whitespace is not content;
 *   - option order IS content (it is what the vendor sees), so it is preserved;
 *   - option objects are canonicalised field-by-field, never spread.
 */

import { createHash } from "node:crypto";

export const QUESTION_DOMAINS = [
  "security",
  "privacy",
  "ai",
  "resilience",
  "nth_party",
  "compliance",
] as const;
export type QuestionDomain = (typeof QUESTION_DOMAINS)[number];

export const QUESTION_ORIGINS = ["securelogic", "customer"] as const;
export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number];

export const QUESTION_STATUSES = ["draft", "active", "retired"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const ANSWER_TYPES = [
  "attest",
  "select_one",
  "select_many",
  "text",
  "numeric",
  "date",
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const EVIDENCE_POLICIES = [
  "none",
  "optional",
  "required_on_pass",
  "required_always",
] as const;
export type EvidencePolicy = (typeof EVIDENCE_POLICIES)[number];

export const LINK_RELATIONS = ["evidences", "partially_evidences"] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

/**
 * What a structured option maps to. This is the SHIPPED response status
 * vocabulary (requirement_responses.status CHECK) — the effectiveness ladder
 * consumes only `status`, so every select option must land on one of these.
 * Imported by value here so a vocabulary drift becomes a test failure, not a
 * CHECK violation at runtime.
 */
export const RESPONSE_STATUSES = [
  "pass",
  "fail",
  "partial",
  "not_assessed",
  "not_applicable",
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

export type QuestionOption = {
  /** Stable machine value; what the response stores. */
  value: string;
  /** What the vendor sees. */
  label: string;
  /** The response status this option resolves to. */
  maps_to_status: ResponseStatus;
};

export type QuestionContent = {
  prompt: string;
  guidance: string | null;
  answer_type: AnswerType;
  options: QuestionOption[] | null;
  evidence_policy: EvidencePolicy;
};

export const QUESTION_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,199}$/;
export const MAX_PROMPT_CHARS = 2000;
export const MAX_GUIDANCE_CHARS = 8000;
export const MAX_OPTIONS = 12;
export const MAX_OPTION_CHARS = 200;

const SELECT_TYPES: ReadonlySet<string> = new Set(["select_one", "select_many"]);

export function isSelectType(t: string): boolean {
  return SELECT_TYPES.has(t);
}

/** Trim; treat empty as absent. */
function normaliseText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export type ContentValidation =
  | { ok: true; content: QuestionContent }
  | { ok: false; error: "invalid_question_content"; fields: Array<{ field: string; reason: string }> };

/**
 * Validate and normalise raw content into its canonical form. Every failure
 * names its field — a generic 400 on a multi-field form is a support ticket.
 */
export function validateQuestionContent(raw: unknown): ContentValidation {
  const b = (raw ?? {}) as Record<string, unknown>;
  const fields: Array<{ field: string; reason: string }> = [];

  const prompt = normaliseText(b.prompt);
  if (!prompt) fields.push({ field: "prompt", reason: "required" });
  else if (prompt.length > MAX_PROMPT_CHARS) fields.push({ field: "prompt", reason: `max ${MAX_PROMPT_CHARS} characters` });

  let guidance: string | null = null;
  if (b.guidance !== undefined && b.guidance !== null) {
    if (typeof b.guidance !== "string") fields.push({ field: "guidance", reason: "must be a string" });
    else {
      guidance = normaliseText(b.guidance);
      if (guidance && guidance.length > MAX_GUIDANCE_CHARS) fields.push({ field: "guidance", reason: `max ${MAX_GUIDANCE_CHARS} characters` });
    }
  }

  const answerType = typeof b.answer_type === "string" ? b.answer_type : "";
  if (!(ANSWER_TYPES as readonly string[]).includes(answerType)) {
    fields.push({ field: "answer_type", reason: `must be one of: ${ANSWER_TYPES.join(", ")}` });
  }

  const evidencePolicy = b.evidence_policy === undefined ? "optional" : b.evidence_policy;
  if (typeof evidencePolicy !== "string" || !(EVIDENCE_POLICIES as readonly string[]).includes(evidencePolicy)) {
    fields.push({ field: "evidence_policy", reason: `must be one of: ${EVIDENCE_POLICIES.join(", ")}` });
  }

  let options: QuestionOption[] | null = null;
  if (isSelectType(answerType)) {
    if (!Array.isArray(b.options) || b.options.length < 2) {
      fields.push({ field: "options", reason: "select answers need at least 2 options" });
    } else if (b.options.length > MAX_OPTIONS) {
      fields.push({ field: "options", reason: `max ${MAX_OPTIONS} options` });
    } else {
      const seen = new Set<string>();
      options = [];
      b.options.forEach((o, i) => {
        const opt = (o ?? {}) as Record<string, unknown>;
        const value = normaliseText(opt.value);
        const label = normaliseText(opt.label);
        const maps = typeof opt.maps_to_status === "string" ? opt.maps_to_status : "";
        if (!value || value.length > MAX_OPTION_CHARS || !/^[a-z0-9][a-z0-9_.-]*$/.test(value)) {
          fields.push({ field: `options[${i}].value`, reason: "required; lowercase machine value" });
        } else if (seen.has(value)) {
          fields.push({ field: `options[${i}].value`, reason: "duplicate" });
        } else {
          seen.add(value);
        }
        if (!label || label.length > MAX_OPTION_CHARS) fields.push({ field: `options[${i}].label`, reason: "required" });
        if (!(RESPONSE_STATUSES as readonly string[]).includes(maps)) {
          fields.push({ field: `options[${i}].maps_to_status`, reason: `must be one of: ${RESPONSE_STATUSES.join(", ")}` });
        }
        options!.push({ value: value ?? "", label: label ?? "", maps_to_status: maps as ResponseStatus });
      });
    }
  } else if (b.options !== undefined && b.options !== null) {
    fields.push({ field: "options", reason: `not allowed for answer_type ${answerType || "(unset)"}` });
  }

  if (fields.length > 0) return { ok: false, error: "invalid_question_content", fields };

  return {
    ok: true,
    content: {
      prompt: prompt!,
      guidance,
      answer_type: answerType as AnswerType,
      options,
      evidence_policy: evidencePolicy as EvidencePolicy,
    },
  };
}

/**
 * The canonical JSON. Fixed key order, normalised text, preserved option order.
 * This string — and only this string — is what gets hashed.
 */
export function canonicalQuestionContent(c: QuestionContent): string {
  const options = c.options
    ? c.options.map((o) => ({ value: o.value, label: o.label, maps_to_status: o.maps_to_status }))
    : null;
  return JSON.stringify({
    prompt: c.prompt.trim(),
    guidance: normaliseText(c.guidance),
    answer_type: c.answer_type,
    options,
    evidence_policy: c.evidence_policy,
  });
}

/** sha256 hex over the canonical form. 64 lowercase hex chars, always. */
export function questionContentHash(c: QuestionContent): string {
  return createHash("sha256").update(canonicalQuestionContent(c), "utf8").digest("hex");
}

/**
 * The bridge shape (VA-Q1 P3): a requirement rendered as the question it is
 * today. Centralised so P2's read path, P3's backfill and the equivalence proof
 * all derive the same content from the same requirement row.
 */
export function bridgeContentForRequirement(req: {
  title: string;
  description: string | null;
}): QuestionContent {
  return {
    prompt: req.title.trim(),
    guidance: normaliseText(req.description),
    answer_type: "attest",
    options: null,
    evidence_policy: "optional",
  };
}

/** The bridge key. Prefixed so curated human keys can never collide with it. */
export function bridgeQuestionKey(frameworkId: string, referenceId: string): string {
  // reference_id is free text per framework ("CC6.1", "A.5.1", "PR.AA-05");
  // fold it into the key's allowed alphabet deterministically.
  const ref = referenceId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `req:${frameworkId}:${ref || "x"}`.slice(0, 200);
}
