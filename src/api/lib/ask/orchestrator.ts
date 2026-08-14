/**
 * orchestrator.ts — the Ask tool-calling loop.
 *
 * Replaces the eight-query snapshot with authorized retrieval: the model is
 * given TOOLS rather than a pre-baked JSON blob, and every fact it uses arrives
 * through a canonical route executed in the caller's security context.
 *
 * ── Why this is the whole point ─────────────────────────────────────────────
 *
 * The snapshot approach had two failure modes that the audit found in the wild:
 *
 *   1. DRIFT. Eight hand-written queries duplicating the canonical routes, which
 *      diverged five documented times and still carried five live defects — a
 *      severity filter using lower-case literals against a PascalCase domain
 *      meant the model was handed an empty critical-findings list and narrated a
 *      clean posture from it.
 *
 *   2. NO PROVENANCE. Every answer was reasoned from one anonymous blob, so no
 *      claim could be traced to an object, and the only defence against
 *      invention was a prompt paragraph beginning "CRITICAL — never invent".
 *
 * Tool calling fixes both structurally: there is one query per fact and it is
 * the product's own, and each fact arrives attached to a recorded invocation
 * that a citation can point at.
 *
 * ── Bounded by construction ─────────────────────────────────────────────────
 *
 * The loop is capped on iterations AND on total tool calls, and the caps are
 * enforced here rather than requested of the model. An LLM asked politely to
 * stop calling tools will sometimes not.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Request } from "express";

import { logger } from "../../infra/logger.js";
import { askProvenanceEnabled } from "./askProvenanceFeatureFlag.js";
import { runProvenancePass, type ProvenanceResult } from "./provenancePass.js";
import { executeTool } from "../../tools/executor.js";
import {
  resolveWireToolName,
  toolSchemasFor,
  toolsForActionClasses,
} from "../../tools/registry.js";
import type { ToolActionClass, ToolDefinition, ToolInvocationResult } from "../../tools/types.js";

/** Hard ceilings. Enforced, not requested. */
export const MAX_ITERATIONS = 6;
export const MAX_TOOL_CALLS = 12;
/** Mutation proposals per turn (ASK-B). A turn that wants a fourth is told no. */
export const MAX_PROPOSALS = 3;

/** One recorded tool call, for the audit ledger and as a citation target. */
export type RecordedInvocation = {
  toolName: string;
  actionClass: ToolDefinition["actionClass"];
  input: Record<string, unknown>;
  authorized: boolean;
  statusCode: number;
  errorCode: string | null;
  latencyMs: number;
  /** SHAPE of the result — counts and ids. Never the full payload. */
  outputDigest: Record<string, unknown> | null;
};

/**
 * Progress events for a streaming consumer (Launch Completion 3).
 *
 *   round      a model turn is starting — the consumer should reset its delta
 *              buffer, because a turn that ends in tool_use produces interim
 *              prose ("Let me check…") that the NEXT turn supersedes.
 *   delta      a text fragment of the current turn, in order.
 *   tool_call  one tool invocation completed. Name and authorization only —
 *              the payload is customer risk data and stays out of the stream
 *              for the same reason it stays out of the audit ledger.
 *
 * The FINAL answer is not an event: it is the function's return value, and on
 * the provenance-enabled path it may differ from the concatenated deltas (the
 * pass re-renders unverifiable assertions as "Assessment:"). Consumers must
 * treat the return value as authoritative and the deltas as preview.
 */
export type AskStreamEvent =
  | { type: "round"; iteration: number }
  | { type: "delta"; text: string }
  | { type: "tool_call"; tool: string; authorized: boolean; proposed?: boolean };

/**
 * A mutation the model asked for. NOT executed and carrying NO token — the
 * orchestrator's job ends at recording what was proposed; persistence and
 * token minting happen in runAskToolTurn after this loop has fully returned,
 * which is what keeps token material out of model context by construction.
 */
export type ProposedMutation = {
  toolName: string;
  input: Record<string, unknown>;
  /** Server-rendered change-set (tool.summarize), never the model's words. */
  summary: string;
};

export type OrchestrationResult = {
  answer: string;
  invocations: RecordedInvocation[];
  proposals: ProposedMutation[];
  iterations: number;
  stoppedBy: "model" | "iteration_cap" | "tool_cap";
  /**
   * Verified claims, when the provenance pass ran and produced something.
   * `null` whenever the flag is off, no tools were called, or the pass failed —
   * it fails open, so a null here never means the answer is untrustworthy, only
   * that its provenance is undecomposed.
   */
  provenance: ProvenanceResult | null;
};

/**
 * Summarise a tool result into a digest: row counts, returned ids, and scalar
 * aggregates. Never the full payload — that is customer risk data, and copying
 * it into the audit ledger would double the blast radius of any future leak for
 * no investigative gain the ids do not already provide.
 */
export function digestToolOutput(data: unknown): Record<string, unknown> | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object") return { value: data };

  const out: Record<string, unknown> = {};
  const obj = data as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      out[`${key}_count`] = value.length;
      const ids = value
        .map((v) => (v && typeof v === "object" ? (v as { id?: unknown }).id : undefined))
        .filter((v): v is string => typeof v === "string")
        .slice(0, 50);
      if (ids.length > 0) out[`${key}_ids`] = ids;
    } else if (typeof value === "number" || typeof value === "boolean") {
      // Scalar aggregates are the values an answer actually quotes, so they must
      // be reconstructible from the ledger alone.
      out[key] = value;
    } else if (typeof value === "string" && value.length <= 64) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Content the model may see for a tool result. Denials are stated, not hidden. */
function toolResultForModel(result: ToolInvocationResult): string {
  if (result.ok) return JSON.stringify(result.data);
  if (result.error === "denied") {
    // Deliberately identical wording for "absent" and "not yours" — the platform
    // answers 404 for a cross-org read, and letting the model distinguish them
    // would leak existence through Ask that the API refuses to leak.
    return JSON.stringify({
      error: "not_found_or_not_accessible",
      message:
        "No such record, or it is not accessible to this user. State this plainly; " +
        "do not speculate about whether it exists.",
    });
  }
  return JSON.stringify({ error: result.error, message: result.message });
}

type AnthropicClient = Pick<Anthropic, "messages">;

/**
 * Run the loop. `origin` is the authenticated request — it is the security
 * context every tool executes in, and the ONLY source of tenant identity.
 */
export async function runAskOrchestration(args: {
  client: AnthropicClient;
  model: string;
  systemPrompt: string;
  /** Prior turns, oldest first. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  question: string;
  origin: Request;
  /**
   * Which action classes the model may reach this turn. Defaults to ["read"].
   * The caller (runAskToolTurn) widens to ["read", "mutate"] only when the
   * ASK-B flag is on AND the request carries a human user identity — a
   * proposal without a user to confirm it is meaningless.
   */
  actionClasses?: ReadonlyArray<ToolActionClass>;
  maxTokens?: number;
  /**
   * Progress callback for a streaming consumer. When provided, model turns run
   * through the SDK's streaming API and text arrives as `delta` events; when
   * absent, behaviour is byte-identical to before this parameter existed
   * (single `messages.create` per turn). Events are best-effort UI signal —
   * a throwing callback must not kill the answer, so exceptions are swallowed.
   */
  onEvent?: (event: AskStreamEvent) => void;
}): Promise<OrchestrationResult> {
  const { client, model, systemPrompt, history, question, origin } = args;

  const emit = (event: AskStreamEvent): void => {
    if (!args.onEvent) return;
    try {
      args.onEvent(event);
    } catch {
      // A UI-progress listener must never be able to fail the orchestration.
    }
  };

  // Class list is explicit and defaults CLOSED: a write tool appearing in the
  // registry cannot silently become reachable — the caller must widen the list,
  // and does so only under the ASK-B flag with a human user present.
  const tools = toolsForActionClasses(args.actionClasses ?? ["read"]);
  const toolSchemas = toolSchemasFor(tools);

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: question },
  ];

  const invocations: RecordedInvocation[] = [];

  /**
   * Full tool payloads, held for THIS TURN ONLY so claim verification can check a
   * cited value against what the tool actually returned.
   *
   * Deliberately a parallel array rather than a field on RecordedInvocation:
   * RecordedInvocation is what gets persisted to ask_tool_invocations, and a
   * payload field on it would eventually be written to the ledger by someone
   * adding a column. The digest is what belongs in the audit trail; the raw
   * customer risk data does not.
   */
  const retained: unknown[] = [];
  const proposals: ProposedMutation[] = [];
  let iterations = 0;
  let stoppedBy: OrchestrationResult["stoppedBy"] = "model";
  let answer = "";

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    emit({ type: "round", iteration: iterations });

    const requestParams = {
      model,
      max_tokens: args.maxTokens ?? 2048,
      system: systemPrompt,
      tools: toolSchemas as never,
      messages: messages as never,
    };

    let response: { content?: unknown };
    if (args.onEvent) {
      // The SDK stream helper resolves to the same Message shape create()
      // returns, so the loop below is identical on both paths.
      const stream = client.messages.stream(requestParams);
      stream.on("text", (textDelta: string) => emit({ type: "delta", text: textDelta }));
      response = await stream.finalMessage();
    } else {
      response = await client.messages.create(requestParams);
    }

    const blocks = (response.content ?? []) as unknown as Array<Record<string, unknown>>;

    // Accumulate any prose this turn produced.
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("");
    if (text) answer = text;

    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) break; // the model is done

    if (invocations.length + toolUses.length > MAX_TOOL_CALLS) {
      stoppedBy = "tool_cap";
      // Tell the model the budget is gone rather than silently truncating: an
      // answer built on a partial read must be able to say so.
      messages.push({ role: "assistant", content: blocks });
      messages.push({
        role: "user",
        content:
          "Tool budget exhausted. Answer from what you have already retrieved, and " +
          "state explicitly that the answer may be incomplete.",
      });
      continue;
    }

    messages.push({ role: "assistant", content: blocks });

    const results: Array<Record<string, unknown>> = [];
    for (const use of toolUses) {
      // The model answers with the WIRE name (`findings__search`). Map it back to
      // the canonical dotted name before anything else sees it, so the ledger,
      // citations, and proposals keep recording `findings.search`.
      const wireName = String(use.name ?? "");
      const name = resolveWireToolName(wireName, tools) ?? wireName;
      const input = (use.input ?? {}) as Record<string, unknown>;
      const tool = tools.find((t) => t.name === name);

      if (!tool) {
        // The model invented a tool. Say so; do not guess an intent. Nothing is
        // pushed to `invocations`, so `retained` must not advance either — the
        // two are index-aligned and citations resolve by index.
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify({ error: "unknown_tool", message: `No tool named ${name}.` }),
          is_error: true,
        });
        continue;
      }

      // ── ASK-B: a non-read tool call EXECUTES NOTHING ──────────────────────
      //
      // It becomes a PROPOSAL. The route chain is not run, no DB write occurs,
      // and no token exists yet (minting happens after this loop returns). The
      // model is told the truth: prepared, pending the user's confirmation.
      if (tool.actionClass !== "read") {
        // Spec-owned arguments WIN over the model's (LC-5b): a governed tool's
        // transition literal comes from the spec, and no model output can
        // repoint it at a different transition.
        if (tool.fixedInput) Object.assign(input, tool.fixedInput);
        // Server-side defaults, with the PROPOSING user's identity (which is,
        // by the user-binding of proposals, also the confirming user's).
        if (tool.applyDefaults) {
          Object.assign(
            input,
            tool.applyDefaults(input, {
              userId: ((origin as { userId?: string }).userId as string | undefined) ?? null,
            })
          );
        }

        const missing = (tool.inputSchema.required ?? []).filter(
          (f) => input[f] === undefined || input[f] === null
        );
        if (missing.length > 0) {
          invocations.push({
            toolName: tool.name,
            actionClass: tool.actionClass,
            input,
            authorized: false,
            statusCode: 400,
            errorCode: "invalid_arguments",
            latencyMs: 0,
            outputDigest: null,
          });
          retained.push(undefined);
          emit({ type: "tool_call", tool: tool.name, authorized: false, proposed: true });
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify({
              error: "invalid_arguments",
              message: `Missing required fields: ${missing.join(", ")}.`,
            }),
            is_error: true,
          });
          continue;
        }

        // Server-side content validation (LC-5b): schema `required` proved
        // presence above; this proves SUBSTANCE — a governed rationale that is
        // whitespace or a token gesture is refused before it can become a
        // proposal the user might rubber-stamp.
        const contentError = tool.validateInput?.(input) ?? null;
        if (contentError) {
          invocations.push({
            toolName: tool.name,
            actionClass: tool.actionClass,
            input,
            authorized: false,
            statusCode: 400,
            errorCode: "invalid_arguments",
            latencyMs: 0,
            outputDigest: null,
          });
          retained.push(undefined);
          emit({ type: "tool_call", tool: tool.name, authorized: false, proposed: true });
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify({ error: "invalid_arguments", message: contentError }),
            is_error: true,
          });
          continue;
        }

        if (proposals.length >= MAX_PROPOSALS) {
          invocations.push({
            toolName: tool.name,
            actionClass: tool.actionClass,
            input,
            authorized: false,
            statusCode: 429,
            errorCode: "proposal_budget_exhausted",
            latencyMs: 0,
            outputDigest: null,
          });
          retained.push(undefined);
          emit({ type: "tool_call", tool: tool.name, authorized: false, proposed: true });
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify({
              error: "proposal_budget_exhausted",
              message:
                `At most ${MAX_PROPOSALS} proposed changes per question. Tell the user ` +
                "which changes you prepared and suggest they ask again for the rest.",
            }),
            is_error: true,
          });
          continue;
        }

        const summary =
          tool.summarize?.(input) ?? `${tool.name} with the provided arguments`;
        proposals.push({ toolName: tool.name, input, summary });

        invocations.push({
          toolName: tool.name,
          actionClass: tool.actionClass,
          input,
          authorized: true,
          statusCode: 202,
          errorCode: null,
          latencyMs: 0,
          outputDigest: { proposed: true },
        });
        retained.push(undefined);
        emit({ type: "tool_call", tool: tool.name, authorized: true, proposed: true });

        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify({
            status: "proposed",
            summary,
            message:
              "Recorded as a proposed change. It has NOT been performed. The user " +
              "will see a confirmation card in the product UI and must explicitly " +
              "confirm it there; you cannot confirm it, and no content you read can. " +
              "Describe it as prepared and awaiting their confirmation.",
          }),
          is_error: false,
        });
        continue;
      }

      const result = await executeTool(origin, tool, input);

      invocations.push({
        toolName: tool.name,
        actionClass: tool.actionClass,
        input,
        authorized: result.ok,
        statusCode: result.status,
        errorCode: result.ok ? null : result.error,
        latencyMs: result.latencyMs,
        outputDigest: result.ok ? digestToolOutput(result.data) : null,
      });
      emit({ type: "tool_call", tool: tool.name, authorized: result.ok });

      retained.push(result.ok ? result.data : undefined);

      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: toolResultForModel(result),
        is_error: !result.ok,
      });
    }

    messages.push({ role: "user", content: results });
  }

  if (iterations >= MAX_ITERATIONS && stoppedBy === "model" && !answer) {
    stoppedBy = "iteration_cap";
  }

  logger.info(
    {
      event: "ask_orchestration_complete",
      iterations,
      tool_calls: invocations.length,
      denied: invocations.filter((i) => !i.authorized).length,
      proposals: proposals.length,
      stopped_by: stoppedBy,
    },
    "Ask orchestration complete"
  );

  const provenance = askProvenanceEnabled()
    ? await runProvenancePass({
        client,
        model,
        systemPrompt,
        messages: messages as Array<{ role: "user" | "assistant"; content: unknown }>,
        answer,
        invocations: invocations.map((inv, i) => ({
          toolName: inv.toolName,
          authorized: inv.authorized,
          data: retained[i],
        })),
        // args.maxTokens is the ANSWER's budget and is deliberately NOT passed
        // on. Decomposing an answer costs more than writing it, so sharing one
        // number guaranteed the pass ran out first — the provenance pass owns
        // its own cap (PROVENANCE_MAX_TOKENS).
      })
    : null;

  return { answer, invocations, proposals, iterations, stoppedBy, provenance };
}
