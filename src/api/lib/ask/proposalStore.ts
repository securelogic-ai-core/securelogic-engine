/**
 * proposalStore.ts — persistence for Ask's proposed mutations (Stop Gate
 * ASK-B, Launch Completion 5).
 *
 * Every function here MUST run inside a tenant scope (withTenant), same
 * contract as conversationStore.ts: they use the ambient `pg` proxy.
 *
 * ── Token custody (the load-bearing part) ───────────────────────────────────
 *
 * The confirmation token is the ONLY thing that can execute a proposal, and
 * its custody chain is what defeats self-confirmation and prompt-injected
 * confirmation structurally:
 *
 *   1. `createProposal` is called by runAskToolTurn AFTER the orchestration
 *      loop has returned — the token does not exist while the model is
 *      running, so no sequence of model turns or injected tool output can
 *      contain it.
 *   2. The raw token (256-bit random, hex) is returned ONCE, placed in the
 *      HTTP response to the proposing user's client, and never persisted or
 *      logged. Only its SHA-256 lands in the row (the
 *      data_export_files.download_token_hash custody model).
 *   3. `claimPendingByTokenHash` is a single atomic UPDATE conditioned on
 *      status = 'pending' — one winner under any concurrency, so replay and
 *      double-submit lose the race and become indistinguishable misses.
 *   4. Every lookup carries organization_id AND user_id: the confirming
 *      request must present the same user in the same org the proposal was
 *      issued to. A colleague's session, another org's key, or a stale
 *      context cannot claim it.
 */

import crypto from "node:crypto";

import { pg } from "../../infra/postgres.js";

/** Proposals are turn-scoped: 15 minutes to confirm, then they are inert. */
export const PROPOSAL_TTL_MS = 15 * 60 * 1000;

export type ProposedActionRecord = {
  id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  summary: string;
  conversation_id: string | null;
};

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Persist a proposal and mint its confirmation token in one step.
 *
 * The raw token is returned to the caller exactly once. This function must
 * only ever be called after the model loop has completed (see custody note).
 */
export async function createProposal(args: {
  organizationId: string;
  userId: string;
  conversationId: string | null;
  toolName: string;
  toolInput: Record<string, unknown>;
  summary: string;
}): Promise<{ id: string; token: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const result = await pg.query<{ id: string; expires_at: string }>(
    `INSERT INTO ask_proposed_actions
       (organization_id, user_id, conversation_id, tool_name, tool_input, summary,
        token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' milliseconds')::interval)
     RETURNING id, expires_at`,
    [
      args.organizationId,
      args.userId,
      args.conversationId,
      args.toolName,
      JSON.stringify(args.toolInput),
      args.summary,
      hashToken(token),
      String(PROPOSAL_TTL_MS),
    ]
  );
  return {
    id: result.rows[0]!.id,
    token,
    expiresAt: result.rows[0]!.expires_at,
  };
}

/**
 * Atomically claim a pending, unexpired proposal for execution.
 *
 * Returns the frozen record on success; null on ANY miss — unknown token,
 * another user's proposal, another org's proposal, expired, already
 * confirmed/declined. Callers must not distinguish these: the route's denial
 * is byte-identical for all of them.
 */
export async function claimPendingByTokenHash(args: {
  organizationId: string;
  userId: string;
  rawToken: string;
}): Promise<ProposedActionRecord | null> {
  const tokenHash = hashToken(args.rawToken);
  const result = await pg.query<ProposedActionRecord>(
    `UPDATE ask_proposed_actions
        SET status = 'confirmed', resolved_at = NOW()
      WHERE token_hash = $1
        AND organization_id = $2
        AND user_id = $3
        AND status = 'pending'
        AND expires_at > NOW()
      RETURNING id, tool_name, tool_input, summary, conversation_id`,
    [tokenHash, args.organizationId, args.userId]
  );
  if ((result.rowCount ?? 0) === 1) return result.rows[0]!;

  // Housekeeping only: surface expiry in the ledger for rows whose token was
  // actually presented. Changes nothing about the response.
  await pg.query(
    `UPDATE ask_proposed_actions
        SET status = 'expired', resolved_at = NOW()
      WHERE token_hash = $1 AND organization_id = $2 AND user_id = $3
        AND status = 'pending' AND expires_at <= NOW()`,
    [tokenHash, args.organizationId, args.userId]
  );
  return null;
}

/** Decline a pending proposal. Same miss semantics as the claim. */
export async function declineByTokenHash(args: {
  organizationId: string;
  userId: string;
  rawToken: string;
}): Promise<ProposedActionRecord | null> {
  const result = await pg.query<ProposedActionRecord>(
    `UPDATE ask_proposed_actions
        SET status = 'declined', resolved_at = NOW()
      WHERE token_hash = $1
        AND organization_id = $2
        AND user_id = $3
        AND status = 'pending'
        AND expires_at > NOW()
      RETURNING id, tool_name, tool_input, summary, conversation_id`,
    [hashToken(args.rawToken), args.organizationId, args.userId]
  );
  return (result.rowCount ?? 0) === 1 ? result.rows[0]! : null;
}

/** Record the canonical chain's outcome on the confirmed row. */
export async function recordExecutionOutcome(args: {
  organizationId: string;
  id: string;
  httpStatus: number;
  digest: Record<string, unknown> | null;
}): Promise<void> {
  await pg.query(
    `UPDATE ask_proposed_actions
        SET executed_http_status = $3, execution_digest = $4
      WHERE id = $1 AND organization_id = $2`,
    [args.id, args.organizationId, args.httpStatus, args.digest ? JSON.stringify(args.digest) : null]
  );
}
