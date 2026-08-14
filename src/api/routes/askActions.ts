/**
 * askActions.ts — confirm/decline for Ask's proposed mutations (Stop Gate
 * ASK-B, Launch Completion 5).
 *
 * These are the ONLY routes that can turn a proposal into an executed
 * mutation, and they can do it only for the caller who holds the raw
 * confirmation token — which the server issued to the proposing user's
 * CLIENT, after the model loop had already ended. The model cannot call
 * these routes, cannot know a token, and cannot be tricked into revealing
 * one it never saw.
 *
 * ── The ASK-B properties, and where each is enforced ────────────────────────
 *
 *  model cannot self-confirm      token minted post-loop (runAskToolTurn),
 *                                 delivered only in the HTTP response
 *  injected content cannot        same custody fact; additionally nothing in
 *  trigger confirmation           the orchestrator executes non-read chains
 *  authorization re-evaluated     executeTool runs the canonical route's FULL
 *  at execution time              chain under the CONFIRMING request — a seat,
 *                                 entitlement, or org change since proposal
 *                                 time is enforced by the product's own gates
 *  bound to the exact mutation    the confirm request carries ONLY the token;
 *                                 tool name + input come from the frozen row
 *  stale proposals cannot run     expires_at conditions the claim
 *  replay cannot duplicate        the claim is one atomic pending→confirmed
 *                                 UPDATE; a consumed token stays consumed even
 *                                 when execution is refused
 *  tenant/user pinned             claim WHERE organization_id = caller's org
 *                                 AND user_id = caller's user
 *  every execution auditable      ask.action.proposed / confirmed+executed /
 *                                 execution_refused / declined / confirm_denied
 *
 * Every failure — malformed token, unknown token, another user's or org's
 * token, expired, already used — returns the byte-identical 404 below. A
 * probing caller learns nothing about which of those it hit.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { askFeatureFlag } from "../lib/askFeatureFlag.js";
import { askActionsEnabled, askGovernedEnabled } from "../lib/ask/askActionsFeatureFlag.js";
import {
  claimPendingByTokenHash,
  declineByTokenHash,
  recordExecutionOutcome,
} from "../lib/ask/proposalStore.js";
import { executeTool } from "../tools/executor.js";
import { getTool } from "../tools/registry.js";
import { digestToolOutput } from "../lib/ask/orchestrator.js";
import { withTenant } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { logger } from "../infra/logger.js";

const router = Router();

/**
 * 404 with the same body a nonexistent route would produce (flag convention).
 * The surface exists when EITHER agentic class is enabled (LC-5b: the two
 * flags are independent); per-proposal executability is re-checked against
 * the specific class's flag after the claim.
 */
function askActionsFlag(_req: Request, res: Response, next: NextFunction): void {
  if (!askActionsEnabled() && !askGovernedEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}

/** Is this tool's action class currently enabled? Read tools are never
 *  confirmable; unknown classes fail closed. */
function classCurrentlyEnabled(actionClass: string): boolean {
  if (actionClass === "mutate") return askActionsEnabled();
  if (actionClass === "governed") return askGovernedEnabled();
  return false;
}

/** The uniform denial. ONE object so the body cannot drift between sites. */
const PROPOSAL_NOT_FOUND = {
  error: "proposal_not_found",
  message: "No confirmable proposal matches this token.",
} as const;

const confirmRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  // Org-keyed — attachOrganizationContext has run by this point in the chain
  // (the transcribe limiter's fragmentation lesson).
  keyGenerator: (req) =>
    (req as any).organizationContext?.organizationId ??
    (req.ip ? ipKeyGenerator(req.ip) : "unknown"),
  message: {
    error: "rate_limit_exceeded",
    message: "Too many confirmation requests. Wait 60 seconds.",
  },
});

const CHAIN = [
  askFeatureFlag,
  askActionsFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  confirmRateLimit,
] as const;

type AuthedRequest = Request & {
  userId?: string;
  apiKey?: { id?: string };
  organizationContext?: { organizationId?: string };
};

/** Raw-token shape: 32 random bytes hex-encoded. Anything else is a miss. */
function extractToken(body: unknown): string | null {
  const t =
    body && typeof body === "object" ? (body as Record<string, unknown>).token : undefined;
  return typeof t === "string" && /^[0-9a-f]{64}$/.test(t) ? t : null;
}

router.post("/ask/actions/confirm", ...CHAIN, async (req, res) => {
  const r = req as AuthedRequest;
  const organizationId = r.organizationContext?.organizationId ?? null;
  const userId = r.userId ?? null;
  const token = extractToken(req.body);

  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const deny = (): void => {
    writeAuditEvent({
      organizationId,
      actorApiKeyId: r.apiKey?.id ?? null,
      actorUserId: userId,
      eventType: "ask.action.confirm_denied",
      resourceType: "ask_proposed_action",
      resourceId: null,
      // NO token material, by design — the reason is deliberately not recorded
      // either, so the ledger cannot become an oracle for which check failed.
      payload: {},
      ipAddress: req.ip ?? null,
    });
    res.status(404).json(PROPOSAL_NOT_FOUND);
  };

  // A caller with no human identity can never own a proposal (user_id is
  // NOT NULL), so this is a miss like any other — not a distinct error.
  if (!token || !userId) {
    deny();
    return;
  }

  try {
    // Claim in its own committed scope BEFORE execution (LC-3 discipline: no
    // tenant transaction held across the canonical chain, which opens its own).
    // Commit-first is also the replay guarantee: once claimed, a second submit
    // misses regardless of what execution does next.
    const record = await withTenant(organizationId, () =>
      claimPendingByTokenHash({ organizationId, userId, rawToken: token })
    );
    if (!record) {
      deny();
      return;
    }

    const tool = getTool(record.tool_name);
    if (!tool || tool.actionClass === "read" || !classCurrentlyEnabled(tool.actionClass)) {
      // The tool is gone (deploy), demoted to read, or its class's flag has
      // been dropped since the proposal was issued. The token is consumed;
      // the proposal is honestly unexecutable — a killed class must not
      // honor tokens it issued while alive.
      await withTenant(organizationId, () =>
        recordExecutionOutcome({
          organizationId,
          id: record.id,
          httpStatus: 503,
          digest: { error: "tool_no_longer_available" },
        })
      );
      res.status(409).json({
        error: "proposal_not_executable",
        message: "This proposed change is no longer available to execute.",
      });
      return;
    }

    // Execute the canonical route chain under the CONFIRMING request's own
    // authenticated context. Entitlement, seat, org scoping, RLS and the
    // route's own validation all re-evaluate HERE, at execution time.
    const result = await executeTool(req, tool, record.tool_input);

    await withTenant(organizationId, () =>
      recordExecutionOutcome({
        organizationId,
        id: record.id,
        httpStatus: result.status,
        // A refusal's REASON is part of the governance record (the route's
        // own error code, e.g. cannot_decide). Denials stay reason-free —
        // their message is the fixed non-disclosing wording by construction.
        digest: result.ok
          ? digestToolOutput(result.data)
          : {
              error: result.error,
              ...(result.error !== "denied" ? { detail: result.message } : {}),
            },
      })
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: r.apiKey?.id ?? null,
      actorUserId: userId,
      eventType: result.ok ? "ask.action.executed" : "ask.action.execution_refused",
      resourceType: "ask_proposed_action",
      resourceId: record.id,
      payload: {
        tool: record.tool_name,
        summary: record.summary,
        http_status: result.status,
        ...(result.ok
          ? {}
          : {
              refusal: result.error,
              ...(result.error !== "denied" ? { refusal_detail: result.message } : {}),
            }),
        conversation_id: record.conversation_id,
        // LC-5b governed context: transition performed, rationale, and the
        // resulting object state extracted from the route's own response —
        // proposal + confirmer (actor fields above) + transition + rationale
        // + outcome land on ONE event.
        ...(tool.auditContext
          ? tool.auditContext(record.tool_input, result.ok ? result.data : null)
          : {}),
      },
      ipAddress: req.ip ?? null,
    });

    if (result.ok) {
      res.status(200).json({
        status: "executed",
        proposal_id: record.id,
        summary: record.summary,
        action: result.data,
      });
    } else {
      // The token is consumed either way — a refusal must not be retryable
      // with the same token. The product's own gates said no; say so plainly.
      res.status(200).json({
        status: "refused",
        proposal_id: record.id,
        summary: record.summary,
        reason: result.error,
        message:
          result.error === "denied"
            ? "The platform declined this change under your current access."
            : result.message,
      });
    }
  } catch (err) {
    logger.error(
      { event: "ask_action_confirm_failed", organizationId, err },
      "Ask action confirmation failed"
    );
    res.status(502).json({ error: "confirm_failed", message: "Unable to process confirmation" });
  }
});

router.post("/ask/actions/decline", ...CHAIN, async (req, res) => {
  const r = req as AuthedRequest;
  const organizationId = r.organizationContext?.organizationId ?? null;
  const userId = r.userId ?? null;
  const token = extractToken(req.body);

  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  if (!token || !userId) {
    res.status(404).json(PROPOSAL_NOT_FOUND);
    return;
  }

  try {
    const record = await withTenant(organizationId, () =>
      declineByTokenHash({ organizationId, userId, rawToken: token })
    );
    if (!record) {
      res.status(404).json(PROPOSAL_NOT_FOUND);
      return;
    }

    writeAuditEvent({
      organizationId,
      actorApiKeyId: r.apiKey?.id ?? null,
      actorUserId: userId,
      eventType: "ask.action.declined",
      resourceType: "ask_proposed_action",
      resourceId: record.id,
      payload: { tool: record.tool_name, summary: record.summary },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ status: "declined", proposal_id: record.id, summary: record.summary });
  } catch (err) {
    logger.error(
      { event: "ask_action_decline_failed", organizationId, err },
      "Ask action decline failed"
    );
    res.status(502).json({ error: "decline_failed", message: "Unable to process decline" });
  }
});

export default router;
