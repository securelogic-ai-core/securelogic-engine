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
// Value imports, not types: the deadline branch below distinguishes a pass cut
// off by its own timeout from a genuine provider failure, and `instanceof` is
// the SDK's own supported way to tell them apart (string-matching the message
// is not).
import { APIConnectionTimeoutError, APIUserAbortError } from "@anthropic-ai/sdk";

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

/**
 * The least time worth starting a pass in. A floor, NOT a throughput estimate:
 * below this even a short answer cannot come back, so starting only delays the
 * answer. Above it the pass runs under a real deadline (see below) and the
 * clock enforces itself.
 */
const PROVENANCE_MIN_DEADLINE_MS = 15_000;

/**
 * Fraction of the remaining request budget the pass may consume. The rest is
 * headroom: finishing the tokens is not the same as the response reaching the
 * client, and the answer still has to be serialized and written after the pass
 * either returns or is cut off.
 */
const PROVENANCE_DEADLINE_FRACTION = 0.8;

/** Never ask for more than this, however long the answer or the budget. */
const PROVENANCE_MAX_TOKENS_CEILING = 16_384;

/**
 * What decomposing THIS answer actually costs.
 *
 * The fixed 4096 above fixed medium answers and left long ones broken. Staging
 * on 2026-08-14 logged `ask_provenance_truncated` for answers of 5939, 7067,
 * 7091, 7911 and 8275 chars — every genuinely long answer, all discarded, all
 * uncited. The cost is not constant because the claims echo the answer VERBATIM
 * inside a JSON envelope, so it scales with the answer.
 *
 * ~4 chars/token for the answer, then ~4x that for the envelope (each claim
 * repeats its sentence, plus claim_class, basis and the cited tool), plus
 * headroom for the array scaffolding.
 */
export function provenanceTokensNeededFor(answerChars: number): number {
  const answerTokens = Math.ceil(answerChars / 4);
  return Math.min(PROVENANCE_MAX_TOKENS_CEILING, Math.max(PROVENANCE_MAX_TOKENS, answerTokens * 4 + 1024));
}

/**
 * The budget this pass may spend, given the time left in the request.
 *
 * WHY THIS NO LONGER PREDICTS. The previous version refused to start unless
 * there was time to generate the ENTIRE cap, converting time to tokens at a
 * hardcoded 89 tok/s. Two things were wrong with that, and staging showed both
 * on 2026-08-14 at build 66204045:
 *
 *   1. It compared a padded SAFETY CEILING against a throughput estimate. The
 *      cap is deliberately generous — `answerTokens * 4 + 1024` — precisely so
 *      the pass does not truncate. Requiring time for all of it double-counts
 *      the padding: the pass declined work it could have finished.
 *   2. Neither constant was ever validated. Nothing recorded what a pass
 *      actually cost, so 89 tok/s and the 4x envelope were folklore that only
 *      ever got more conservative.
 *
 * The result was a refusal that BLAMED THE CLOCK while the clock was not the
 * constraint: a 7,135-char answer was returned uncited with 45.5 SECONDS still
 * left in the request, because 3,237 "affordable" tokens did not reach the
 * 8,160-token cap.
 *
 * So the pass stops guessing. The deadline is now REAL — `deadlineMs` is passed
 * to the SDK as a request timeout, so an over-running pass is aborted rather
 * than allowed to consume the request budget. That is what made the prediction
 * unnecessary: THIS PASS can no longer overrun the request and 504, which is
 * the whole failure the forecast existed to avoid, so a wrong estimate is now
 * a late uncited answer rather than a dead request. (It bounds this call only —
 * orchestration upstream owns its own share of the budget.)
 *
 * What remains is a FLOOR, not a forecast: below `PROVENANCE_MIN_DEADLINE_MS`
 * nothing can come back, so starting only delays the answer.
 *
 * The tradeoff is stated plainly: a pass that runs and is cut off costs the
 * tokens it generated and delays the answer by up to the deadline. The answer
 * still ships — the same uncited degradation as before, just later. That is the
 * price of no longer refusing long answers that would in fact have finished.
 */
export function provenanceBudgetFor(
  answerChars: number,
  msRemaining: number
): { maxTokens: number; deadlineMs: number; viable: boolean } {
  return {
    // The cap still bounds the OUTPUT, and over-estimating here is harmless —
    // it is a ceiling the model rarely reaches, not a reservation. A truncated
    // payload is discarded whole (see the max_tokens branch below), so the cap
    // wants headroom; it just must not be mistaken for a time cost.
    maxTokens: provenanceTokensNeededFor(answerChars),
    deadlineMs: Math.floor(msRemaining * PROVENANCE_DEADLINE_FRACTION),
    viable: msRemaining >= PROVENANCE_MIN_DEADLINE_MS,
  };
}

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
  /**
   * Milliseconds left before the HTTP request is killed. When supplied, the
   * pass sizes itself to fit and declines to start if it cannot finish.
   * Absent = no clock (tests, and any caller with no request behind it).
   */
  msRemaining?: number;
}): Promise<ProvenanceResult | null> {
  const { client, model, systemPrompt, messages, answer, invocations } = args;

  // No retrieval happened, so there is nothing an observed claim could cite and
  // the whole answer is inference. Saying so costs a round trip and tells the
  // user nothing they cannot see from the absence of citations.
  if (invocations.length === 0) return null;

  // Size to the answer AND to the clock. Explicit maxTokens (tests) still wins.
  let budgetedMaxTokens = args.maxTokens ?? PROVENANCE_MAX_TOKENS;
  let deadlineMs: number | undefined;
  if (args.maxTokens === undefined && args.msRemaining !== undefined) {
    const budget = provenanceBudgetFor(answer.length, args.msRemaining);
    if (!budget.viable) {
      // Time genuinely IS the constraint on this branch — that is the whole
      // reason the floor exists — so the message can say so without lying. The
      // old message said this on a turn with 45s left; the numbers are logged
      // alongside it now so the claim stays checkable.
      logger.warn(
        {
          event: "ask_provenance_skipped_no_time",
          answerChars: answer.length,
          msRemaining: args.msRemaining,
          msRequired: PROVENANCE_MIN_DEADLINE_MS,
        },
        "Too little time left in the request to start decomposing this answer — returning it uncited"
      );
      return null;
    }
    budgetedMaxTokens = budget.maxTokens;
    deadlineMs = budget.deadlineMs;
  }

  const startedAt = Date.now();
  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: budgetedMaxTokens,
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
      },
      // THE DEADLINE IS THE SAFETY PROPERTY, and it is what lets the gate above
      // be a floor instead of a forecast. Without it an over-running pass would
      // eat the request budget and 504 — the failure the old prediction existed
      // to avoid.
      //
      // `maxRetries: 0` is load-bearing, not tidiness: the SDK retries timeouts
      // by default (2 retries), so a 30s timeout would become 90s of wall clock
      // and reintroduce the 504 through the very mechanism meant to prevent it.
      // A provenance pass is best-effort anyway — a retry costs the request
      // budget to re-attempt work whose failure is already handled.
      deadlineMs === undefined ? undefined : { timeout: deadlineMs, maxRetries: 0 }
    );

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
          maxTokens: budgetedMaxTokens,
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

    // WHAT THE PASS ACTUALLY COST. The budget constants were unvalidated for as
    // long as they existed because nothing recorded this: `usage.output_tokens`
    // and the elapsed time were available on every completed pass and thrown
    // away, so a wrong throughput assumption could only ever be argued about.
    // Logged against answerChars and the cap, these make the model derivable
    // from production data instead of folklore.
    const usage = (response as { usage?: { output_tokens?: number } }).usage;
    logger.info(
      {
        event: "ask_provenance_complete",
        claims: verified.claims.length,
        observed: verified.claims.filter((c) => c.claim_class === "observed").length,
        downgraded: verified.issues.length,
        reasons: [...new Set(verified.issues.map((i) => i.reason))],
        answerChars: answer.length,
        maxTokens: budgetedMaxTokens,
        outputTokens: usage?.output_tokens ?? null,
        elapsedMs: Date.now() - startedAt,
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
    // A pass cut off by its own deadline is a BUDGET outcome, not a fault, and
    // conflating the two is what made the previous behaviour hard to read: the
    // pass is expected to overrun sometimes now that it no longer refuses to
    // start. Its own event carries the elapsed time and the answer size, which
    // is the measurement that says whether the deadline is set right.
    if (err instanceof APIConnectionTimeoutError || err instanceof APIUserAbortError) {
      logger.warn(
        {
          event: "ask_provenance_deadline_exceeded",
          answerChars: answer.length,
          maxTokens: budgetedMaxTokens,
          deadlineMs: deadlineMs ?? null,
          elapsedMs: Date.now() - startedAt,
        },
        "Provenance pass hit its deadline — answer returned uncited, request budget preserved"
      );
      return null;
    }
    // Fail open, loudly in the log and silently to the user.
    logger.warn({ event: "ask_provenance_failed", err }, "Provenance pass failed — falling back");
    return null;
  }
}
