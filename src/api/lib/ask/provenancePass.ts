/**
 * provenancePass.ts — turn a finished answer into VERIFIED claims.
 *
 * ── Why a second call rather than asking for claims up front ──────────────────
 * Asking the model to emit structured claims *while* it is still deciding which
 * tools to call makes it do two jobs at once, and the reliable failure is that it
 * degrades the reasoning to satisfy the format. Running the decomposition after
 * the answer exists means the answer is unaffected by the provenance feature —
 * turning the flag off changes what is displayed, never what is concluded.
 *
 * ── Why the model is asked to cite itself, when it could lie ─────────────────
 * It can, and that is the entire point of the pass. The model proposes; the
 * VERIFIER decides. `verifyClaims` re-checks every observed claim against the
 * tool payload actually returned this turn, and any claim whose value does not
 * appear in the data it cites is DOWNGRADED to `inference` rather than dropped.
 * Dropping would silently delete content from a user's answer; downgrading tells
 * the truth about what the sentence is.
 *
 * This is the ratified boundary applied to Ask: the model assists, and does not
 * become the hidden authority for whether something is a fact.
 *
 * ── Why it fails open ────────────────────────────────────────────────────────
 * Every failure here — the model declining the tool, a malformed payload, a
 * provider error — returns null and the caller renders the plain answer. Ask
 * remains a synchronous user-facing request, and a display feature must not be
 * able to take it down.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { logger } from "../../infra/logger.js";
import {
  CLAIM_CLASSES,
  parseClaims,
  renderClaims,
  verifyClaims,
  type Claim,
  type InvocationForVerification,
  type VerificationIssue,
} from "./claims.js";

/** What the caller gets back. `null` means "no provenance this turn". */
export type ProvenanceResult = {
  claims: Claim[];
  issues: VerificationIssue[];
  /** The answer re-rendered from verified claims, with class prefixes. */
  renderedAnswer: string;
  /** True when nothing had to be downgraded. */
  clean: boolean;
};

/**
 * The provenance pass's OWN output budget, deliberately not the answer's.
 *
 * Decomposing an answer costs more tokens than writing it: every sentence comes
 * back verbatim inside a JSON envelope, wrapped in a citation array. Measured on
 * staging 2026-08-14, a 15-claim answer produced ~1600 tokens of claims — so the
 * 2048 this used to inherit from the ANSWER's budget was below the cost of
 * decomposing a merely ordinary answer. Long answers hit the cap, the payload
 * came back truncated, and `ask_provenance_unparseable` swallowed it: citations
 * silently vanished while the feature flag still read as on.
 *
 * 4096 is measured, not guessed. Generation ran ~89 tok/s, so this is ~46s of
 * worst-case provenance on top of ~17s of orchestration — inside the 90s request
 * budget in app.ts. That coupling is real: raising this without raising the
 * request timeout trades a silent failure for a 504.
 */
const PROVENANCE_MAX_TOKENS = 4096;

const SUBMIT_TOOL = {
  name: "submit_claims",
  description:
    "Decompose the answer you just gave into individual claims, each labelled " +
    "with how it is known and citing the tool call it came from.",
  input_schema: {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "One self-contained sentence of the answer, verbatim where possible.",
            },
            claim_class: {
              type: "string",
              enum: [...CLAIM_CLASSES],
              description:
                "observed = a value read directly from a tool result. " +
                "derived = computed from observed values. " +
                "inference = your judgement or interpretation. " +
                "recommendation = a suggested action.",
            },
            citations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  invocation_index: {
                    type: "integer",
                    description: "0-based index into the tool calls listed in the instruction.",
                  },
                  tool_name: { type: "string" },
                  object_type: { type: "string" },
                  object_id: { type: "string" },
                  field: { type: "string" },
                  value: {
                    description:
                      "The exact value asserted, copied from the tool result. This is " +
                      "checked against the real payload; a value that does not appear " +
                      "there will be reclassified.",
                  },
                },
                required: ["invocation_index", "tool_name"],
              },
            },
            derived_from: {
              type: "array",
              items: { type: "integer" },
              description: "For inference: indices of the claims this reasons from.",
            },
          },
          required: ["text", "claim_class", "citations"],
        },
      },
    },
    required: ["claims"],
  },
} as const;

const INSTRUCTION =
  "Now decompose the answer you just gave into claims, using the submit_claims tool.\n\n" +
  "Rules:\n" +
  "- Every sentence of your answer must appear as exactly one claim. Do not add " +
  "content that was not in the answer, and do not omit any.\n" +
  "- Label `observed` ONLY for a value you read directly from a tool result, and " +
  "cite that tool call with the exact value. Copy the value; do not round, " +
  "reformat or summarise it.\n" +
  "- If you cannot point to the tool call a statement came from, it is `inference`, " +
  "not `observed`. That is a correct and expected label — it is not a failure.\n" +
  "- A statement about a record you were DENIED access to is never `observed`.\n\n" +
  "Tool calls made this turn:\n";

/** The compact ledger the model cites into. Denials are listed, not hidden. */
function describeInvocations(invocations: InvocationForVerification[]): string {
  if (invocations.length === 0) return "  (none)\n";
  return invocations
    .map(
      (inv, i) =>
        `  [${i}] ${inv.toolName}${inv.authorized ? "" : "  — DENIED, cannot support an observed claim"}`
    )
    .join("\n");
}

type AnthropicClient = Pick<Anthropic, "messages">;

export async function runProvenancePass(args: {
  client: AnthropicClient;
  model: string;
  systemPrompt: string;
  /** The full conversation as it stood when the answer was produced. */
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  answer: string;
  invocations: InvocationForVerification[];
  maxTokens?: number;
}): Promise<ProvenanceResult | null> {
  const { client, model, systemPrompt, messages, answer, invocations } = args;

  // No retrieval happened, so there is nothing an observed claim could cite and
  // the whole answer is inference. Saying so costs a round trip and tells the
  // user nothing they cannot see from the absence of citations.
  if (invocations.length === 0) return null;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: args.maxTokens ?? PROVENANCE_MAX_TOKENS,
      system: systemPrompt,
      tools: [SUBMIT_TOOL] as never,
      // Forced: the model must produce the structure. Asking politely for JSON
      // in prose and parsing it is the failure mode this avoids.
      tool_choice: { type: "tool", name: SUBMIT_TOOL.name } as never,
      messages: [
        ...messages,
        { role: "assistant" as const, content: answer },
        {
          role: "user" as const,
          content: INSTRUCTION + describeInvocations(invocations),
        },
      ] as never,
    });

    const blocks = (response.content ?? []) as unknown as Array<Record<string, unknown>>;
    const use = blocks.find((b) => b.type === "tool_use" && b.name === SUBMIT_TOOL.name);
    const stopReason = (response as { stop_reason?: string | null }).stop_reason ?? null;
    const rawClaims = (use?.input as { claims?: unknown })?.claims;

    // A TRUNCATED response is discarded whole, even when the part that arrived
    // parses cleanly — which it does whenever the cut happens to land on an
    // element boundary. This is not caution about citation quality; it is the
    // answer itself. `renderedAnswer` REPLACES the prose the user sees and the
    // prose that gets stored, so a claim set missing its tail would silently
    // delete the end of their answer, and it would look deliberate. Better no
    // provenance than a quietly shortened answer.
    if (stopReason === "max_tokens") {
      logger.warn(
        {
          event: "ask_provenance_truncated",
          maxTokens: args.maxTokens ?? PROVENANCE_MAX_TOKENS,
          claimsReturned: Array.isArray(rawClaims) ? rawClaims.length : null,
          answerChars: answer.length,
        },
        "Provenance pass hit its output cap — claims discarded, answer left unchanged"
      );
      return null;
    }

    if (!use) {
      logger.info({ event: "ask_provenance_no_tool_use" }, "Provenance pass produced no claims");
      return null;
    }

    const parsed = parseClaims(rawClaims);
    if (!parsed || parsed.length === 0) {
      // Distinct from the truncation case above, and carrying enough to tell
      // them apart in a log search — the old message said only "did not parse",
      // which is why the live failure took a reproduction to diagnose.
      logger.info(
        {
          event: "ask_provenance_unparseable",
          stopReason,
          claimsReturned: Array.isArray(rawClaims) ? rawClaims.length : null,
        },
        "Provenance claims did not parse"
      );
      return null;
    }

    // THE LOAD-BEARING LINE. Everything above is the model's proposal.
    const verified = verifyClaims(parsed, invocations);

    logger.info(
      {
        event: "ask_provenance_complete",
        claims: verified.claims.length,
        observed: verified.claims.filter((c) => c.claim_class === "observed").length,
        downgraded: verified.issues.length,
        reasons: [...new Set(verified.issues.map((i) => i.reason))],
      },
      "Ask provenance pass complete"
    );

    return {
      claims: verified.claims,
      issues: verified.issues,
      renderedAnswer: renderClaims(verified.claims),
      clean: verified.clean,
    };
  } catch (err) {
    // Fail open, loudly in the log and silently to the user.
    logger.warn({ event: "ask_provenance_failed", err }, "Provenance pass failed — falling back");
    return null;
  }
}
