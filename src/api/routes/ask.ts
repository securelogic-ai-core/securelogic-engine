/**
 * ask.ts — Natural language risk posture search ("Ask SecureLogic")
 *
 * POST /api/ask
 *
 * Accepts a plain-English question, fetches a real-time org-scoped
 * data snapshot from 7 parallel DB queries, and sends the snapshot
 * plus the question to Claude. Claude synthesises a structured answer
 * using ONLY the provided data — it never touches the DB.
 *
 * Security:
 *   - All DB queries are hardcoded parameterized statements; no SQL is
 *     generated from user input.
 *   - Rate limited to 20 questions / minute per org to contain Claude costs.
 *   - Claude receives only org-scoped pre-fetched data — no raw DB access.
 */

import Anthropic from "@anthropic-ai/sdk";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Router, type Request, type Response } from "express";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { instrumentAnthropicClient } from "../infra/providerQuotaAlert.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  collapseEntitlementLevel,
  type EntitlementClass,
} from "../lib/entitlementClass.js";
import { renderProductKnowledge } from "../lib/productKnowledge.js";
import {
  sqlFindingActive,
  sqlFindingClosed,
  sqlFindingSignalSourced,
  sqlFindingVendorSourced,
  sqlVendorAssessmentScope
} from "../lib/metricDefinitions.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { askFeatureFlag } from "../lib/askFeatureFlag.js";
import { askToolsEnabled } from "../lib/ask/askToolsFeatureFlag.js";
import { askStreamingEnabled } from "../lib/ask/askStreamingFeatureFlag.js";
import { askActionsEnabled, askGovernedEnabled } from "../lib/ask/askActionsFeatureFlag.js";
import { runAskOrchestration, type AskStreamEvent } from "../lib/ask/orchestrator.js";
import { createProposal } from "../lib/ask/proposalStore.js";
import { enrichProposalSummary } from "../lib/ask/governedSummaries.js";
import { getTool } from "../tools/registry.js";
import type { ToolActionClass } from "../tools/types.js";
import {
  createConversation,
  findOwnedConversation,
  listConversations,
  loadHistory,
  loadMessages,
  recordAssistantMessage,
  recordUserMessage,
  type AskTurn,
} from "../lib/ask/conversationStore.js";
import { enqueueProvenanceJob } from "../lib/ask/provenanceJobs.js";
import { toDisplayScore } from "../lib/postureDisplay.js";

const router = Router();

// ---------------------------------------------------------------------------
// Claude model
//
// Single source of truth for the model the Ask handler calls. Keep in sync
// with the codebase's other Sonnet-tier callers (briefSynthesizer.ts:38 and
// intelligenceBriefGenerator.ts:756) so a model bump only requires one edit
// per file. Was previously hardcoded as "claude-sonnet-4-20250514" in two
// places — that ID is retired and Anthropic returns model_not_found, which
// surfaced as 502 ask_failed in production.
// ---------------------------------------------------------------------------

const ASK_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Claude client
// ---------------------------------------------------------------------------

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return instrumentAnthropicClient(new Anthropic({ apiKey: key }));
}

// ---------------------------------------------------------------------------
// System prompt
//
// Ask answers from TWO knowledge sources and must route between them:
//   1. PRODUCT KNOWLEDGE (static, injected below from productKnowledge.ts) —
//      how the platform works: navigation, features, how-to workflows. Used to
//      answer questions like "How do I add a vendor?". This is the fix for the
//      old behavior where Ask, having only the org data snapshot, wrongly said
//      it lacked the information for any how-to question.
//   2. ORG POSTURE DATA (per-request, in the user message) — this customer's
//      live findings/risks/vendors/posture. Used to answer "what is my …?".
//
// The base instructions establish the routing + guardrails; the rendered
// product-knowledge block is appended once at module load (it is identical
// across requests, which also keeps it prompt-cache friendly).
// ---------------------------------------------------------------------------

const BASE_INSTRUCTIONS = `
You are SecureLogic AI, the assistant embedded in the SecureLogic AI platform — a cyber, GRC, AI-governance, and third-party-risk posture product. You help customers in two ways and must choose the right source for each question:

1. PRODUCT / HOW-TO / NAVIGATION questions — e.g. "How do I add a vendor?", "Where is my Intelligence Brief?", "How do I improve my posture score?", "What can this platform do?". Answer these from the SECURELOGIC PRODUCT KNOWLEDGE section at the end of this prompt. That section is authoritative, current product documentation. When the answer is there, give it directly and helpfully — tell the user exactly where to click and the steps to follow. Do NOT say you "only" handle posture data, that you "don't have access", or that you "can't help with navigation" — if the product knowledge answers the question, you DO have the answer.

2. DATA / POSTURE questions — e.g. "What are my top risks?", "How many overdue actions do I have?", "Which vendors are critical?". Answer these using ONLY the organization posture data provided in the user message. Never invent data, scores, names, or ratings not present in that org context.

If a question has both aspects, answer both: explain the workflow from product knowledge AND cite the relevant numbers from the org context. Only state that something is unavailable if it is genuinely absent from BOTH the product knowledge and the org context — never reflexively claim a lack of access.

When answering:
- Lead with the direct answer
- For posture questions, support it with specific numbers from the org context
- For how-to questions, give the concrete navigation path / steps
- Highlight the most actionable insight when relevant
- Be concise — 2-4 sentences for simple questions, up to 8 for complex analyses
- Use plain language, not jargon

Risk ratings:
- Each risk has TWO ratings: inherent (pre-controls / worst case) and residual (post-controls / current state).
- When discussing a specific risk, label them clearly. Format as "Inherent rating: {value}, Residual rating: {value}".
- When summarizing risks in aggregate, default to residual unless the user explicitly asks about inherent (residual is "what we worry about right now given current mitigations"; inherent is "what we'd worry about if our controls failed").
- The legacy "risk_rating" field is the same value as residual_rating; treat them as equivalent.
- If a risk has a null inherent_rating or residual_rating, say so rather than guessing.

Format rules:
- Do not use markdown headers
- You may use bullet points for lists of 3+ items
- For posture answers, always cite specific numbers (e.g. "3 critical findings" not "several critical findings")

CRITICAL — applies to ORGANIZATION DATA only: never invent, assume, or generate proper nouns about this customer's environment — vendor names, domain names, team names, person names, or specific risk titles — that are not explicitly present in the org context data. If a list is empty or a field is null, state that no data is available rather than providing examples (e.g. if the vendor list is empty, say "no vendors have been added yet" — do not name hypothetical vendors). This rule does NOT restrict the PRODUCT KNOWLEDGE section: the feature names, navigation labels, and URL paths there are real and you should use them freely to answer how-to questions.
`.trim();

export function buildAskSystemPrompt(cls?: EntitlementClass): string {
  return `${BASE_INSTRUCTIONS}\n\n---\n\n${renderProductKnowledge(cls)}`;
}

/**
 * The requester's entitlement class, for the product-knowledge prompt variant.
 *
 * ASK IS A PLATFORM SURFACE (ruling 2026-08-15). All four Ask routes — /ask,
 * /ask/stream, /ask/conversations and /ask/conversations/:id — sit behind the
 * premium entitlement guard, so by the time any handler runs this, the class
 * can only be `premium`. The `starter` and `professional` prompt variants are
 * therefore UNREACHABLE in production today.
 *
 * (Written without the literal guard expression on purpose: vendorEntitlementGate
 * .test.ts counts occurrences of it in this file to assert how many routes are
 * gated, and a mention in prose would inflate that count into a false pass.)
 *
 * They are retained rather than deleted, deliberately, and this function exists
 * so the reason is written down instead of inferred:
 *
 *   1. renderProductKnowledge(cls) is shared and independently tested; the
 *      filtering itself is correct and is not what was wrong.
 *   2. If the premium gate is ever loosened — the live question behind W-6,
 *      since Brief Pro and Brief Team are sold tiers — the correct prompt must
 *      already be selected. Hard-coding the premium variant here would turn a
 *      future gate change into a silent leak of platform surface names into a
 *      lower tier's prompt.
 *
 * What was actually wrong (W-6) is that this looked like an ACTIVE filter while
 * being unable to fire, so nobody would learn if the invariant broke. Hence the
 * alarm below: if a non-premium class ever reaches Ask, that is a gate change or
 * a gate defect, and it is logged at error level rather than quietly working.
 * askRoutesArePlatformOnly.test.ts pins the invariant at the source level so the
 * two cannot drift apart unnoticed.
 */
function resolveRequesterClass(entitlementLevel: unknown): EntitlementClass {
  const cls = collapseEntitlementLevel(
    typeof entitlementLevel === "string" ? entitlementLevel : null
  );
  if (cls !== "premium") {
    logger.error(
      { event: "ask_entitlement_class_unexpected", requesterClass: cls },
      "Ask reached by a non-premium entitlement class — the premium gate on the " +
        "Ask routes has changed or failed. The filtered prompt variant is being " +
        "used, but this path is not supposed to be reachable."
    );
  }
  return cls;
}

/**
 * Requester-aware system prompts (Launch Completion 2 — Ask access truth):
 * one per entitlement class, memoized so each renders once per process and
 * provider-side prompt caching stays effective. A class's prompt OMITS every
 * destination and workflow that class cannot actually use, so the assistant
 * cannot route a customer to a page whose guard would bounce them.
 */
const SYSTEM_PROMPT_BY_CLASS = new Map<EntitlementClass, string>();
function systemPromptFor(cls: EntitlementClass): string {
  let p = SYSTEM_PROMPT_BY_CLASS.get(cls);
  if (p === undefined) {
    p = buildAskSystemPrompt(cls);
    SYSTEM_PROMPT_BY_CLASS.set(cls, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Rate limiter — 20 questions per minute per org
// ---------------------------------------------------------------------------

/**
 * Per-ORG limiter. 20 questions/minute.
 *
 * This read `(req as any).organizationId`, which is assigned NOWHERE in the
 * codebase — attachOrganizationContext sets `req.organizationContext.organizationId`.
 * So the key was always undefined and every request fell through to the IP
 * branch. Behind Cloudflare `req.ip` is a rotating edge address (the same root
 * cause that makes the tier-2 auth-anomaly detector unable to fire), so the
 * per-org cap the file header advertises did not exist: the limiter was
 * fragmenting across edge IPs and Ask was an uncapped spend surface.
 *
 * Falling back to the IP is still correct for a request that has no org context
 * — but such a request is rejected by the handler anyway, so the fallback is now
 * a genuine last resort rather than the normal path.
 */
const askRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const orgId =
      (req as unknown as { organizationContext?: { organizationId?: string | null } })
        .organizationContext?.organizationId ?? null;
    if (orgId) return `org:${orgId}`;
    return req.ip ? ipKeyGenerator(req.ip) : "unknown";
  },
  message: {
    error: "rate_limit_exceeded",
    message: "Too many questions. Wait 60 seconds.",
  },
});

// ---------------------------------------------------------------------------
// Tool-path handler
//
// The model is given authorized TOOLS over canonical routes instead of a
// pre-assembled snapshot. It runs inside the caller's own request, so every
// tool call carries that caller's entitlement, seat, capability and RLS.
//
// Conversation persistence is BEST-EFFORT and never fails the answer: a user
// asking a question should not get a 500 because history could not be written.
// The audit event is written regardless, on the same path as the snapshot
// handler, so auditability does not depend on which retrieval path ran.
// ---------------------------------------------------------------------------

const TOOL_PROMPT_VERSION = "ask_tools_v1";

/**
 * One complete tool-path turn: conversation resolution, orchestration,
 * persistence, audit — everything except writing the HTTP response. Shared by
 * the JSON handler and the SSE handler (Launch Completion 3) so the two
 * response shapes cannot drift: the SSE `final` event IS this return value,
 * byte-shape-identical to the JSON body.
 *
 * `onEvent` streams orchestration progress (rounds, text deltas, tool calls);
 * its presence changes nothing about retrieval, persistence, or audit except
 * a `streamed: true` marker in the audit payload.
 */
async function runAskToolTurn(args: {
  req: Request;
  client: Anthropic;
  organizationId: string;
  question: string;
  onEvent?: (event: AskStreamEvent) => void;
}): Promise<Record<string, unknown>> {
  const { req, client, organizationId, question } = args;
  const userId = (req as { userId?: string }).userId ?? null;
  // Platform-only surface; see resolveRequesterClass. Always `premium` today.
  const requesterClass: EntitlementClass = resolveRequesterClass(
    (req as any).organizationContext?.entitlementLevel
  );
  const requestedConversationId =
    typeof (req.body as Record<string, unknown>)?.conversation_id === "string"
      ? ((req.body as Record<string, string>).conversation_id ?? null)
      : null;

  try {
    // History load + conversation resolution run in their own tenant scope and
    // COMMIT before the model call, so no DB connection is held across a
    // multi-second round trip (the discipline the snapshot path already follows).
    let conversationId: string | null = null;
    let history: AskTurn[] = [];

    try {
      await withTenant(organizationId, async () => {
        if (requestedConversationId) {
          const owned = await findOwnedConversation({
            organizationId,
            userId,
            conversationId: requestedConversationId,
          });
          // Not found and not-yours are indistinguishable: a probing caller must
          // not learn that a colleague's thread exists. We simply start fresh.
          if (owned) {
            conversationId = owned.id;
            history = await loadHistory({ organizationId, conversationId: owned.id });
          }
        }
        if (!conversationId) {
          // Titled from the opening question so the thread list is legible.
          // Deterministic truncation, not a model call: a title is navigation,
          // not analysis.
          conversationId = await createConversation({
            organizationId,
            userId,
            title: question.length > 80 ? `${question.slice(0, 77)}...` : question,
          });
        }
        await recordUserMessage({
          organizationId,
          conversationId: conversationId!,
          userId,
          content: question,
        });
      });
    } catch (persistErr) {
      // Conversation storage is not worth failing a question over.
      logger.warn(
        { event: "ask_conversation_persist_failed", organizationId, persistErr },
        "Ask conversation persistence failed (non-fatal)"
      );
    }

    logger.info(
      { event: "llm_call_start", purpose: "ask_tools", model: ASK_MODEL, organizationId },
      "LLM call: ask (tool path)"
    );

    // ASK-B: non-read classes reach the model only under their OWN flags AND
    // a human user identity — a proposal is confirmed by its USER, so a bare
    // API key gets read tools only. The two flags are INDEPENDENT by operator
    // ruling (LC-5b): each gates exactly its class. The class list defaults
    // closed inside the orchestrator; this is the single widening site.
    const actionClasses: ToolActionClass[] = ["read"];
    if (userId !== null) {
      if (askActionsEnabled()) actionClasses.push("mutate");
      if (askGovernedEnabled()) actionClasses.push("governed");
    }
    const proposalsPossible = actionClasses.length > 1;

    const orchestration = await runAskOrchestration({
      client,
      model: ASK_MODEL,
      systemPrompt: systemPromptFor(requesterClass),
      history,
      question,
      origin: req,
      actionClasses,
      ...(args.onEvent ? { onEvent: args.onEvent } : {}),
      // Stamped by the timeout middleware in app.ts. Absent only for a caller
      // with no HTTP request behind it, where there is no clock to respect.
      ...(typeof (req as { deadlineAt?: number }).deadlineAt === "number"
        ? { deadlineAt: (req as { deadlineAt?: number }).deadlineAt as number }
        : {}),
    });

    // The provenance pass re-renders the answer from VERIFIED claims, so a
    // sentence the model called observed but could not substantiate arrives
    // prefixed "Assessment:" rather than as a bare assertion of fact. When the
    // pass did not run — flag off, no tools called, or it failed open — the
    // model's own prose is used unchanged.
    const answer =
      orchestration.provenance?.renderedAnswer ||
      orchestration.answer ||
      "I was not able to produce an answer for that.";

    if (conversationId) {
      try {
        const messageId = await withTenant(organizationId, () =>
          recordAssistantMessage({
            organizationId,
            conversationId: conversationId!,
            userId,
            content: answer,
            modelId: ASK_MODEL,
            promptVersion: TOOL_PROMPT_VERSION,
            // The verified-claims record, stored WITH the answer it describes —
            // this is what lets a reloaded transcript replay its citations
            // exactly as verified at answer time. Omitting it left the claims
            // column always NULL and every reloaded thread citation-less.
            claims: orchestration.provenance?.claims,
            invocations: orchestration.invocations,
            // Stamped at insert so a turn is never briefly stateless. The
            // deferred case is written as 'pending' here and by the enqueue
            // below; doing it in both places means a crash between them still
            // leaves the UI telling the truth.
            provenanceStatus: orchestration.deferredProvenance
              ? "pending"
              : orchestration.provenance
                ? orchestration.provenance.clean
                  ? "complete"
                  : "partial"
                : null,
          })
        );

        // ── Deferred provenance ────────────────────────────────────────────
        // Outside the persist transaction on purpose: Postgres aborts a whole
        // transaction on any failed statement, so enqueuing inside it would let
        // a queue problem roll back the ANSWER. Citations are what degrades
        // here, never the answer — and a failed enqueue leaves the turn as an
        // ordinary uncited one rather than a permanently "processing" one.
        if (orchestration.deferredProvenance) {
          await enqueueProvenanceJob({
            organizationId,
            userId,
            messageId,
            answer,
            modelId: ASK_MODEL,
            payloads: orchestration.deferredProvenance.payloads,
          });
        }
      } catch (persistErr) {
        logger.warn(
          { event: "ask_answer_persist_failed", organizationId, persistErr },
          "Ask answer persistence failed (non-fatal)"
        );
      }
    }

    // ── ASK-B: persist proposals and mint their confirmation tokens ─────────
    //
    // THIS is the custody boundary. The orchestration loop has fully returned:
    // the model's context is closed and can never contain what is minted here.
    // Raw tokens go into the HTTP payload below (the client's confirmation
    // card) and nowhere else — not the ledger, not the logs, not the
    // conversation store.
    const proposedActions: Array<{
      id: string;
      tool: string;
      summary: string;
      token: string;
      expires_at: string;
    }> = [];
    if (proposalsPossible && userId && orchestration.proposals.length > 0) {
      try {
        await withTenant(organizationId, async () => {
          for (const proposal of orchestration.proposals) {
            // LC-5b: governed summaries carry SERVER-sourced object identity
            // (org-scoped lookup). An object this org cannot see — a
            // hallucinated id or a cross-tenant probe — DROPS the proposal:
            // no row, no token, no card. Fails toward not mutating.
            const enriched = await enrichProposalSummary(
              organizationId,
              proposal.toolName,
              proposal.input,
              proposal.summary
            );
            if (!enriched.ok) {
              logger.warn(
                {
                  event: "ask_proposal_object_not_visible",
                  organizationId,
                  tool: proposal.toolName,
                },
                "Ask proposal dropped: target object not visible to this org"
              );
              continue;
            }
            const created = await createProposal({
              organizationId,
              userId,
              conversationId,
              toolName: proposal.toolName,
              toolInput: proposal.input,
              summary: enriched.summary,
              ...(getTool(proposal.toolName)?.proposalTtlMs !== undefined
                ? { ttlMs: getTool(proposal.toolName)!.proposalTtlMs! }
                : {}),
            });
            proposedActions.push({
              id: created.id,
              tool: proposal.toolName,
              summary: enriched.summary,
              token: created.token,
              expires_at: created.expiresAt,
            });
          }
        });
        for (const p of proposedActions) {
          writeAuditEvent({
            organizationId,
            actorApiKeyId: (req as any).apiKey?.id ?? null,
            actorUserId: userId,
            eventType: "ask.action.proposed",
            resourceType: "ask_proposed_action",
            resourceId: p.id,
            payload: { tool: p.tool, summary: p.summary, conversation_id: conversationId },
            ipAddress: req.ip ?? null,
          });
        }
      } catch (persistErr) {
        // Degraded, honestly: the answer still returns, but with no proposal
        // cards — the model told the user confirmation is required, and none
        // arrives, which errs toward NOT mutating. Never partial-render.
        proposedActions.length = 0;
        logger.error(
          { event: "ask_proposal_persist_failed", organizationId, persistErr },
          "Ask proposal persistence failed; proposals dropped"
        );
      }
    }

    writeAuditEvent({
      organizationId,
      actorApiKeyId: (req as any).apiKey?.id ?? null,
      actorUserId: userId,
      eventType: "ask.question.asked",
      resourceType: "ask",
      resourceId: conversationId,
      payload: {
        question: question.slice(0, 500),
        model: ASK_MODEL,
        answer_length: answer.length,
        retrieval: "tools",
        proposals: proposedActions.length,
        streamed: args.onEvent !== undefined,
        // The tool ledger IS the context digest on this path: which authorized
        // reads happened, and which were refused.
        tool_calls: orchestration.invocations.map((i) => ({
          tool: i.toolName,
          authorized: i.authorized,
          status: i.statusCode,
        })),
        stopped_by: orchestration.stoppedBy,
        // Downgrades are a signal worth keeping: a rising rate means the model
        // is asserting things the data does not support, which is exactly the
        // failure the provenance pass exists to catch.
        provenance: orchestration.provenance
          ? {
              claims: orchestration.provenance.claims.length,
              downgraded: orchestration.provenance.issues.length,
              reasons: [...new Set(orchestration.provenance.issues.map((i) => i.reason))],
            }
          : null,
      },
      ipAddress: req.ip ?? null,
    });

    return {
      answer,
      question,
      conversation_id: conversationId,
      // Same key the snapshot path returns, so the app needs no change to read
      // it — but sourced from the tool ledger rather than a fixed blob.
      context_used: {
        retrieval: "tools",
        tool_calls: orchestration.invocations.length,
        tools_denied: orchestration.invocations.filter((i) => !i.authorized).length,
        complete: orchestration.stoppedBy === "model",
      },
      // ASK-B: proposed mutations awaiting the user's confirmation. The token
      // is the client's alone; it exists nowhere else. Absent when there are
      // none, so pre-LC-5 consumers see an unchanged shape.
      ...(proposedActions.length > 0 ? { proposed_actions: proposedActions } : {}),
      // The lifecycle state, so the client can render "Sources processing…"
      // instead of silently showing an uncited answer that is about to gain
      // citations. Absent when provenance was never applicable to this turn.
      ...(orchestration.deferredProvenance
        ? { provenance_status: "pending" as const }
        : orchestration.provenance
          ? {
              provenance_status: (orchestration.provenance.clean
                ? "complete"
                : "partial") as "complete" | "partial",
            }
          : {}),
      // Absent rather than empty when the pass did not run, so a client can tell
      // "no provenance available" from "provenance says nothing was observed".
      ...(orchestration.provenance
        ? {
            provenance: {
              verified: orchestration.provenance.clean,
              claims: orchestration.provenance.claims.map((c) => ({
                text: c.text,
                claim_class: c.claim_class,
                citations: c.citations.map((cit) => ({
                  tool: cit.tool_name,
                  ...(cit.object_type ? { object_type: cit.object_type } : {}),
                  ...(cit.object_id ? { object_id: cit.object_id } : {}),
                  ...(cit.field ? { field: cit.field } : {}),
                })),
              })),
            },
          }
        : {}),
    };
  } catch (err) {
    logger.error({ event: "ask_tools_failed", organizationId, err }, "Ask tool path failed");
    throw err;
  }
}

async function handleWithTools(args: {
  req: Request;
  res: Response;
  client: Anthropic;
  organizationId: string;
  question: string;
}): Promise<void> {
  const { res, ...turnArgs } = args;
  try {
    const payload = await runAskToolTurn(turnArgs);
    res.status(200).json(payload);
  } catch {
    // Already logged (with the org id) where it happened.
    res.status(502).json({ error: "ask_failed", message: "Unable to process query" });
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler (Launch Completion 3)
//
// Same turn, same authorization, same audit — the only difference is HOW the
// answer travels: orchestration progress and text deltas as they happen, then
// a `final` event carrying the exact payload the JSON route would have sent.
//
// Deltas are PREVIEW. The provenance pass may re-render the answer after the
// last delta, so the client must replace streamed text with `final.answer`.
// All request validation happens in the route handler BEFORE headers are
// flushed; past that point every failure is an `error` event, never a status.
//
// DB discipline is inherited from runAskToolTurn: every withTenant scope
// commits before the model round-trips, so no connection is ever held open
// across the life of the stream (the failure mode that makes the asTenant
// route wrap and streaming incompatible — this handler must never be wrapped).
// ---------------------------------------------------------------------------

function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleWithToolsStream(args: {
  req: Request;
  res: Response;
  client: Anthropic;
  organizationId: string;
  question: string;
}): Promise<void> {
  const { res, ...turnArgs } = args;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Defence against buffering proxies that respect it (nginx and friends).
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const payload = await runAskToolTurn({
      ...turnArgs,
      onEvent: (event) => {
        // The requester may hang up mid-stream; keep orchestrating (the turn
        // still persists and audits) but stop writing to a dead socket.
        if (!res.writableEnded) sseWrite(res, event.type, event);
      },
    });
    sseWrite(res, "final", payload);
  } catch {
    // Already logged in runAskToolTurn. Same outward wording as the JSON 502.
    if (!res.writableEnded) {
      sseWrite(res, "error", { error: "ask_failed", message: "Unable to process query" });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

// ---------------------------------------------------------------------------
// POST /api/ask
// ---------------------------------------------------------------------------

/**
 * Shared request validation for both Ask endpoints. Writes the error response
 * and returns null when the request is unusable; extraction (rather than
 * duplication in the stream route) is what keeps the two routes' status
 * semantics from drifting. All of this runs BEFORE any SSE upgrade, so the
 * stream route still answers plain JSON statuses for bad requests.
 */
function validateAskRequest(
  req: Request,
  res: Response
): { organizationId: string; question: string; client: Anthropic } | null {
  const organizationContext = (req as any).organizationContext ?? null;
  const organizationId = organizationContext?.organizationId ?? null;

  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return null;
  }

  const { question } = req.body ?? {};

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "question_required", message: "question is required and must be a non-empty string" });
    return null;
  }

  if (question.trim().length > 500) {
    res.status(400).json({ error: "question_too_long", message: "question must be 500 characters or fewer" });
    return null;
  }

  const client = getClient();
  if (!client) {
    res.status(503).json({ error: "ask_unavailable", message: "AI query is not configured" });
    return null;
  }

  return { organizationId, question: question.trim(), client };
}

router.post(
  "/ask",
  askFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  askRateLimit,
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    // Platform-only surface; see resolveRequesterClass. Always `premium` today.
    const requesterClass: EntitlementClass = resolveRequesterClass(
      organizationContext?.entitlementLevel
    );

    const validated = validateAskRequest(req, res);
    if (!validated) return;
    const { organizationId, client, question } = validated;

    // ── Retrieval path switch ────────────────────────────────────────────
    //
    // The TOOL path gives the model authorized tools over canonical routes,
    // so every fact arrives through the product's own query with the caller's
    // entitlement, seat, capability and RLS applied. The SNAPSHOT path below
    // is the A0-corrected eight-query blob it replaces.
    //
    // Dark by default (SECURELOGIC_ASK_TOOLS_ENABLED). Rollback is the flag:
    // no migration, no deploy, no data change. Two retrieval implementations
    // is exactly the parallel-data-path problem this programme removes — it is
    // a transition, not a steady state, and the snapshot path retires with the
    // flag once staging validates the tool path.
    if (askToolsEnabled()) {
      await handleWithTools({ req, res, client, organizationId, question });
      return;
    }

    try {
      // -----------------------------------------------------------------------
      // Fetch all context data in parallel — 8 queries (+ risk scale)
      // -----------------------------------------------------------------------
      const {
        postureResult,
        domainResult,
        findingsSummaryResult,
        topRisksResult,
        vendorCountResult,
        vendorsResult,
        actionsSummaryResult,
        criticalFindingsResult,
        riskScaleResult,
      } = await withTenant(organizationId, async () => {
        // Serialized reads on the single tenant client (commit-then-compute):
        // the Claude call below runs AFTER this tenant tx COMMITs, so the DB
        // connection is never held open across the multi-second LLM round-trip.
        // 1. Latest posture snapshot
        const postureResult = await pg.query<{
          overall_score: number | null;
          overall_severity: string | null;
          open_finding_count: number;
          open_action_count: number;
          overdue_action_count: number;
          snapshot_date: string;
          computation_rationale: Record<string, unknown>;
        }>(
          `SELECT overall_score, overall_severity,
                  open_finding_count, open_action_count, overdue_action_count,
                  snapshot_date, computation_rationale
           FROM posture_snapshots
           WHERE organization_id = $1
           ORDER BY snapshot_date DESC
           LIMIT 1`,
          [organizationId]
        );

        // 2. Domain scores from latest snapshot
        const domainResult = await pg.query<{
          domain: string;
          score: number | null;
          severity: string | null;
          trend_direction: string | null;
          finding_count: number;
          action_count: number;
        }>(
          `SELECT d.domain, d.score, d.severity, d.trend_direction,
                  d.finding_count, d.action_count
           FROM domain_scores d
           JOIN posture_snapshots p ON d.posture_snapshot_id = p.id
           WHERE p.organization_id = $1
           ORDER BY p.snapshot_date DESC, d.score ASC
           LIMIT 20`,
          [organizationId]
        );

        // 3. Findings summary — the ACTIVE population (Metric Contract), so the
        // assistant answers with the same numbers the product shows.
        //
        // Two defects fixed here: the severity literals were lower-cased
        // ('critical', 'high', 'medium', 'low') and matched NOTHING — the domain
        // is 'Critical' | 'High' | 'Moderate' | 'Low' (findings.ts VALID_SEVERITIES),
        // so all four counts were permanently 0 and 'medium' was not even a value.
        // And `closed_count` was `status != 'open'`, reporting in-progress work as
        // closed. The assistant was reasoning from a posture of zero severe findings.
        //
        // The two provenance counts now come from the Metric Contract
        // (sqlFindingVendorSourced / sqlFindingSignalSourced) rather than a
        // route-local list. They were `source_type = 'vendor_review'` and
        // `source_type = 'signal'`, which missed vendor review CYCLES entirely,
        // and missed every finding the matcher writes as 'cyber_signal' plus the
        // newer 'intelligence_event'. Ask reported those populations as zero.
        const findingsSummaryResult = await pg.query<{
          active_count: string;
          critical_active: string;
          high_active: string;
          medium_active: string;
          low_active: string;
          closed_count: string;
          immediate_priority: string;
          vendor_sourced: string;
          signal_sourced: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE ${sqlFindingActive()})                              AS active_count,
             COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'Critical')    AS critical_active,
             COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'High')        AS high_active,
             COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'Moderate')    AS medium_active,
             COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'Low')         AS low_active,
             COUNT(*) FILTER (WHERE ${sqlFindingClosed()})                              AS closed_count,
             COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND priority = 'immediate')   AS immediate_priority,
             COUNT(*) FILTER (WHERE ${sqlFindingVendorSourced()})                       AS vendor_sourced,
             COUNT(*) FILTER (WHERE ${sqlFindingSignalSourced()})                       AS signal_sourced
           FROM findings
           WHERE organization_id = $1`,
          [organizationId]
        );

        // 4. Top open risks ordered by severity
        const topRisksResult = await pg.query<{
          id: string;
          title: string;
          domain: string;
          likelihood: string | null;
          impact: string;
          risk_rating: string;
          inherent_rating: string | null;
          residual_rating: string | null;
          status: string;
          owner: string | null;
          due_date: string | null;
          treatment: string | null;
        }>(
          // Residual primary per Decision §3. Inherent surfaced for
          // LLM context — the prompt instruction below ("Inherent
          // rating: X, Residual rating: Y") tells the model to
          // distinguish them in conversation.
          `SELECT id, title, domain, likelihood, impact, risk_rating,
                  inherent_rating, residual_rating,
                  status, owner, due_date, treatment
           FROM risks
           WHERE organization_id = $1
             AND status = 'open'
           ORDER BY
             CASE residual_rating
               WHEN 'Critical' THEN 1
               WHEN 'High'     THEN 2
               WHEN 'Moderate' THEN 3
               WHEN 'Low'      THEN 4
             END ASC
           LIMIT 20`,
          [organizationId]
        );

        // 5a. ACTIVE vendor count.
        //
        // This filtered `status != 'inactive'`, which is a no-op: vendors.status
        // is NOT NULL with CHECK (status IN ('active','archived')), so no row can
        // ever hold 'inactive'. The predicate was an idiom borrowed from the
        // USERS table (member removal sets users.status = 'inactive'), where it
        // is correct — on vendors it excluded nothing, and every count below
        // silently included the archived half of the register while the comment
        // above it claimed otherwise.
        //
        // status = 'active' is the platform-canonical vendor population, already
        // used by GET /api/vendors (default), /api/vendors/summary, and the
        // dashboard vendor_risk breakdown. Ask was the sole outlier, so its
        // numbers disagreed with every other surface the customer can open.
        const vendorCountResult = await pg.query<{ total: string }>(
          `SELECT COUNT(*) AS total
           FROM vendors
           WHERE organization_id = $1
             AND status = 'active'`,
          [organizationId]
        );

        // 5b. All ACTIVE vendors ordered by criticality then risk score.
        //
        // Same population as 5a, by the same predicate — every metric described
        // as an active-vendor metric must derive from the identical set, and the
        // breakdown below would otherwise contradict the total beside it.
        //
        // Archived vendors were previously named to the model in `list`, and the
        // system prompt explicitly authorises it to use names present in the org
        // context. So Ask could name a decommissioned third party as live risk.
        //
        // Assessment state is computed HERE, in the database, from the ratified
        // definition (Metric Contract): a vendor is assessed when it has at
        // least one row in vendor_assessments.
        //
        // It replaces last_reviewed_at, which used to be selected and handed to
        // the model as `last_reviewed`. Nothing in the product writes that
        // column, so it was NULL for effectively every vendor and the model was
        // free to narrate that as a review history — the least controlled
        // surface for a false claim in the whole product, because an LLM
        // phrases it freshly each time and there is no string to grep for.
        const vendorsResult = await pg.query<{
          id: string;
          name: string;
          criticality: string | null;
          current_risk_score: number | null;
          assessment_count: number;
          latest_assessment_at: string | null;
        }>(
          `SELECT id, name, criticality, current_risk_score,
                  (SELECT COUNT(*) ${sqlVendorAssessmentScope()})::int AS assessment_count,
                  (SELECT va.performed_at ${sqlVendorAssessmentScope()}
                    ORDER BY va.created_at DESC, va.id DESC
                    LIMIT 1)                                           AS latest_assessment_at
           FROM vendors
           WHERE organization_id = $1
             AND status = 'active'
           ORDER BY
             CASE criticality
               WHEN 'critical' THEN 1
               WHEN 'high'     THEN 2
               WHEN 'medium'   THEN 3
               WHEN 'low'      THEN 4
               ELSE 5
             END,
             current_risk_score DESC NULLS LAST`,
          [organizationId]
        );

        // 6. Actions summary
        const actionsSummaryResult = await pg.query<{
          open_count: string;
          blocked_count: string;
          overdue_count: string;
          immediate_count: string;
          closed_count: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status IN ('open', 'in_progress', 'blocked'))               AS open_count,
             COUNT(*) FILTER (WHERE status = 'blocked')                                          AS blocked_count,
             COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('closed', 'accepted'))   AS overdue_count,
             COUNT(*) FILTER (WHERE priority = 'immediate' AND status NOT IN ('closed','accepted')) AS immediate_count,
             COUNT(*) FILTER (WHERE status = 'closed')                                           AS closed_count
           FROM actions
           WHERE organization_id = $1`,
          [organizationId]
        );

        // 7. Recent High/Critical ACTIVE findings.
        //
        // This carried the SAME defect that was fixed in query 3 above and was
        // missed here: the severity literals were lower-cased ('critical',
        // 'high') and the domain is PascalCase — findings.ts:87
        // VALID_SEVERITIES = {Critical, High, Moderate, Low}. The predicate
        // matched NOTHING for any finding created through the API, so the
        // "recent critical findings" list handed to the model was permanently
        // empty and Ask narrated a posture with no severe findings in it.
        //
        // It also used `status = 'open'`, which is not the canonical population:
        // sqlFindingActive() is the authoritative operational axis and is what
        // query 3 ten lines above already uses. A list that disagrees with the
        // count beside it is worse than either alone.
        const criticalFindingsResult = await pg.query<{
          title: string;
          severity: string;
          status: string;
          source_type: string;
          domain: string | null;
          priority: string | null;
          created_at: string;
        }>(
          `SELECT title, severity, status, source_type, domain, priority, created_at
           FROM findings
           WHERE organization_id = $1
             AND severity IN ('Critical', 'High')
             AND ${sqlFindingActive()}
           ORDER BY
             CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 END,
             created_at DESC
           LIMIT 15`,
          [organizationId]
        );

        // 8. Org risk scale
        const riskScaleResult = await pg.query<{
          preset_name: string;
          custom_levels: Array<{ value: string; label: string; color: string; rank: number }> | null;
          preset_levels: Array<{ value: string; label: string; color: string; rank: number }>;
          display_name: string;
        }>(
          `SELECT
             COALESCE(ors.preset_name, 'standard')  AS preset_name,
             ors.custom_levels,
             rsp.levels                              AS preset_levels,
             rsp.display_name
           FROM risk_scale_presets rsp
           LEFT JOIN organization_risk_scales ors
             ON ors.organization_id = $1
             AND ors.preset_name = rsp.name
           WHERE rsp.name = COALESCE(
             (SELECT preset_name FROM organization_risk_scales WHERE organization_id = $1),
             'standard'
           )`,
          [organizationId]
        );
        return {
          postureResult,
          domainResult,
          findingsSummaryResult,
          topRisksResult,
          vendorCountResult,
          vendorsResult,
          actionsSummaryResult,
          criticalFindingsResult,
          riskScaleResult,
        };
      });

      // -----------------------------------------------------------------------
      // Assemble context object
      // -----------------------------------------------------------------------
      const posture = postureResult.rows[0] ?? null;
      const fs  = findingsSummaryResult.rows[0];
      const as_ = actionsSummaryResult.rows[0];

      const scaleRow = riskScaleResult.rows[0] ?? null;
      const scaleLevels = scaleRow?.custom_levels ?? scaleRow?.preset_levels ?? [];
      const riskScaleContext = {
        name:   scaleRow?.display_name ?? "Standard",
        levels: scaleLevels.map((l: { label: string }) => l.label),
      };

      const findingsSummary = {
        active_count:       parseInt(fs?.active_count ?? "0", 10),
        critical_active:    parseInt(fs?.critical_active ?? "0", 10),
        high_active:        parseInt(fs?.high_active ?? "0", 10),
        medium_active:      parseInt(fs?.medium_active ?? "0", 10),
        low_active:         parseInt(fs?.low_active ?? "0", 10),
        closed_count:       parseInt(fs?.closed_count ?? "0", 10),
        immediate_priority: parseInt(fs?.immediate_priority ?? "0", 10),
        vendor_sourced:     parseInt(fs?.vendor_sourced ?? "0", 10),
        signal_sourced:     parseInt(fs?.signal_sourced ?? "0", 10),
      };

      const actionsSummary = {
        open_count:      parseInt(as_?.open_count ?? "0", 10),
        blocked_count:   parseInt(as_?.blocked_count ?? "0", 10),
        overdue_count:   parseInt(as_?.overdue_count ?? "0", 10),
        immediate_count: parseInt(as_?.immediate_count ?? "0", 10),
        closed_count:    parseInt(as_?.closed_count ?? "0", 10),
      };

      const context = {
        risk_scale: riskScaleContext,
        posture: posture
          ? {
              // Health-style display value (walkthrough ruling): Ask answers must
              // quote the same number the dashboard shows.
              overall_score:    toDisplayScore(posture.overall_score),
              overall_severity: posture.overall_severity,
              open_findings:    posture.open_finding_count,
              open_actions:     posture.open_action_count,
              overdue_actions:  posture.overdue_action_count,
              as_of:            posture.snapshot_date,
            }
          : null,
        domains: domainResult.rows.map((d) => ({
          domain:   d.domain,
          score:    toDisplayScore(d.score),
          severity: d.severity,
          trend:    d.trend_direction,
          findings: d.finding_count,
        })),
        findings:  findingsSummary,
        top_risks: topRisksResult.rows,
        vendors: {
          // `active_total`, not `total`: the population is active vendors only,
          // and the model is never told otherwise anywhere else in the prompt.
          // Correcting the predicate while leaving the key called "total" would
          // just move the falsehood — the model would keep reporting an
          // active-only figure as the customer's whole vendor register.
          active_total:   parseInt(vendorCountResult.rows[0]?.total ?? "0", 10),
          critical_count: vendorsResult.rows.filter((v) => v.criticality === "critical").length,
          high_count:     vendorsResult.rows.filter((v) => v.criticality === "high").length,
          // ASSESSED = has at least one vendor_assessments row (Metric
          // Contract), the same definition /vendors and /vendors/risk print.
          //
          // This counted `current_risk_score !== null`, which is a SCORE, not
          // an assessment: GET /api/vendors/:id/risk-score computes and
          // persists one on demand, so a vendor nobody had ever assessed
          // acquired a score and began counting as assessed — and the model
          // reported it to the customer as assessment coverage.
          assessed_count: vendorsResult.rows.filter((v) => v.assessment_count > 0).length,
          never_assessed_count: vendorsResult.rows.filter((v) => v.assessment_count === 0).length,
          list: vendorsResult.rows.map((v) => ({
            name:         v.name,
            criticality:  v.criticality,
            // A real, maintained field: recomputed and persisted by the vendor
            // risk-score pipeline. Kept because its meaning is supported —
            // it just is not evidence that anyone assessed the vendor.
            risk_score:   v.current_risk_score,
            assessments:  v.assessment_count,
            last_assessed: v.latest_assessment_at,
          })),
        },
        actions:   actionsSummary,
        critical_findings: criticalFindingsResult.rows,
      };

      // -----------------------------------------------------------------------
      // Call Claude
      // -----------------------------------------------------------------------
      const scaleInstruction = riskScaleContext.levels.length > 0
        ? `\n\nThis organization uses the following risk rating scale: ${riskScaleContext.levels.join(", ")}. Use these exact labels when referring to risk levels.`
        : "";

      const userMessage = `Here is the current risk posture data for this organization:\n\n${JSON.stringify(context, null, 2)}${scaleInstruction}\n\nQuestion: ${question.trim()}`;

      let answer: string;
      try {
        logger.info(
          { event: "llm_call_start", purpose: "ask_query", model: ASK_MODEL, organizationId },
          "LLM call: ask query"
        );
        const response = await client.messages.create({
          model: ASK_MODEL,
          max_tokens: 1024,
          system: systemPromptFor(requesterClass),
          messages: [{ role: "user", content: userMessage }],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        answer = textBlock && "text" in textBlock ? textBlock.text : "";
      } catch (claudeErr) {
        logger.error({ event: "ask_claude_failed", organizationId, claudeErr }, "Claude API call failed");
        res.status(502).json({ error: "ask_failed", message: "Unable to process query" });
        return;
      }

      // Ask recorded NOTHING before this: no audit event for the question, the
      // answer, or the org data that fed it. An LLM-mediated read path over
      // customer risk data that leaves no trace is not auditable, which is a
      // hard requirement for a governance product — "who asked what, and what
      // were they shown" must be answerable after the fact.
      //
      // The question is recorded; the ANSWER is not. Answers are unbounded model
      // output and belong in conversation storage (Ask A1), not in audit_log.
      // The context_used digest records the shape of what the model saw, so an
      // investigator can tell whether an answer could have been grounded.
      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "ask.question.asked",
        resourceType: "ask",
        resourceId: null,
        payload: {
          question: question.trim().slice(0, 500),
          model: ASK_MODEL,
          answer_length: answer.length,
          context_digest: {
            findings_active: findingsSummary.active_count,
            risks: topRisksResult.rows.length,
            vendors_active: parseInt(vendorCountResult.rows[0]?.total ?? "0", 10),
            critical_findings_listed: criticalFindingsResult.rows.length,
            posture_as_of: posture?.snapshot_date ?? null
          }
        },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({
        answer,
        context_used: {
          // Same mapper as the LLM context above — context_used is customer-visible
          // and must quote the same health-style number the answer was built from.
          posture_score:   toDisplayScore(posture?.overall_score ?? null),
          findings_count:  findingsSummary.active_count,
          risks_count:     topRisksResult.rows.length,
          vendors_count:   parseInt(vendorCountResult.rows[0]?.total ?? "0", 10),
          as_of:           posture?.snapshot_date ?? null,
        },
        question: question.trim(),
      });
    } catch (err) {
      logger.error({ event: "ask_failed", err }, "POST /api/ask failed");
      res.status(500).json({ error: "ask_failed", message: "Unable to process query" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/ask/stream — the same turn over SSE (Launch Completion 3)
//
// Identical gate chain INCLUDING the rate limiter instance, so the streaming
// and JSON endpoints draw from one 20/min per-org budget rather than doubling
// it. Requires BOTH flags: the tool path (streaming is not built for the
// retiring snapshot path) and the streaming dark-launch flag. Off = 404 with
// the same body a nonexistent route would produce, matching askFeatureFlag.
// ---------------------------------------------------------------------------

router.post(
  "/ask/stream",
  askFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  askRateLimit,
  async (req, res) => {
    if (!askStreamingEnabled() || !askToolsEnabled()) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const validated = validateAskRequest(req, res);
    if (!validated) return;
    const { organizationId, client, question } = validated;

    await handleWithToolsStream({ req, res, client, organizationId, question });
  }
);

// ---------------------------------------------------------------------------
// Conversation reads — the A3 multi-turn UI surface.
//
// Same gate chain as POST /ask minus the rate limiter (these never touch a
// model). User-scoped in the store: a colleague's threads are invisible, and
// not-found vs not-yours is indistinguishable, because a thread can contain
// data filtered to the OWNER's seat scope and is phrased for them.
// ---------------------------------------------------------------------------

router.get(
  "/ask/conversations",
  askFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const userId = (req as { userId?: string }).userId ?? null;
    try {
      const conversations = await withTenant(organizationId, () =>
        listConversations({ organizationId, userId })
      );
      res.status(200).json({ conversations });
    } catch (err) {
      logger.error({ event: "ask_conversation_list_failed", organizationId, err }, "Ask conversation list failed");
      res.status(500).json({ error: "conversation_list_failed" });
    }
  }
);

router.get(
  "/ask/conversations/:id",
  askFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const userId = (req as { userId?: string }).userId ?? null;
    const conversationId = String(req.params["id"] ?? "");
    // A malformed id is a not-found, not a 500: `id = $1` casts to uuid and a
    // junk string would otherwise throw at the DB layer.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    try {
      const result = await withTenant(organizationId, async () => {
        const owned = await findOwnedConversation({ organizationId, userId, conversationId });
        if (!owned) return null;
        const messages = await loadMessages({ organizationId, conversationId: owned.id });
        return { conversation: owned, messages };
      });
      if (!result) {
        res.status(404).json({ error: "conversation_not_found" });
        return;
      }
      res.status(200).json(result);
    } catch (err) {
      logger.error({ event: "ask_conversation_read_failed", organizationId, err }, "Ask conversation read failed");
      res.status(500).json({ error: "conversation_read_failed" });
    }
  }
);

export default router;
