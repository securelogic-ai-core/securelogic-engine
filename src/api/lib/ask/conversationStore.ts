/**
 * conversationStore.ts — persistence for Ask threads.
 *
 * Every function here MUST run inside a tenant scope (the route's asTenant wrap
 * or an explicit withTenant). They use the ambient `pg` proxy, so calling one
 * outside a scope would run unscoped against the owner channel.
 *
 * ── User scoping is enforced here, not just by RLS ──────────────────────────
 *
 * RLS isolates by ORGANISATION. It does not stop a colleague in the same org
 * reading your thread — and they must not, because a thread can contain data
 * filtered to YOUR seat scope (a Contributor sees only assigned objects) and is
 * phrased for you. So every read carries a user predicate as well, and RLS is
 * the backstop rather than the whole control.
 *
 * A caller with no user identity (an API key with no human behind it) gets
 * conversations with `user_id IS NULL`, and can only ever see those.
 */

import { pg } from "../../infra/postgres.js";
import type { RecordedInvocation } from "./orchestrator.js";

export type AskConversation = {
  id: string;
  title: string | null;
  mode: "text" | "voice";
  last_message_at: string | null;
};

export type AskTurn = { role: "user" | "assistant"; content: string };

/** Predicate matching the caller's own conversations — NULL-safe. */
function userPredicate(userId: string | null, params: unknown[]): string {
  if (userId === null) return "user_id IS NULL";
  params.push(userId);
  return `user_id = $${params.length}`;
}

export async function createConversation(args: {
  organizationId: string;
  userId: string | null;
  mode?: "text" | "voice";
  title?: string | null;
}): Promise<string> {
  const result = await pg.query<{ id: string }>(
    `INSERT INTO ask_conversations (organization_id, user_id, mode, title)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [args.organizationId, args.userId, args.mode ?? "text", args.title ?? null]
  );
  return result.rows[0]!.id;
}

/**
 * Resolve a conversation the caller owns. Returns null when it does not exist
 * OR belongs to someone else — indistinguishable on purpose, so a probing caller
 * cannot learn that a colleague's thread exists.
 */
export async function findOwnedConversation(args: {
  organizationId: string;
  userId: string | null;
  conversationId: string;
}): Promise<AskConversation | null> {
  const params: unknown[] = [args.conversationId, args.organizationId];
  const predicate = userPredicate(args.userId, params);
  const result = await pg.query<AskConversation>(
    `SELECT id, title, mode, last_message_at
       FROM ask_conversations
      WHERE id = $1 AND organization_id = $2 AND ${predicate}
      LIMIT 1`,
    params
  );
  return result.rows[0] ?? null;
}

/**
 * Prior turns, oldest first, bounded.
 *
 * The window is a COST and CORRECTNESS bound, not a UI concern: an unbounded
 * history grows the prompt without limit, and the tail of a long thread
 * contributes little while making every later answer more expensive.
 */
export async function loadHistory(args: {
  organizationId: string;
  conversationId: string;
  limit?: number;
}): Promise<AskTurn[]> {
  const limit = Math.min(args.limit ?? 20, 50);
  const result = await pg.query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM (
       SELECT role, content, created_at, id
         FROM ask_messages
        WHERE conversation_id = $1 AND organization_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [args.conversationId, args.organizationId, limit]
  );
  return result.rows;
}

/**
 * The caller's own threads, most recently active first.
 *
 * User-scoped like every read here: a colleague's threads are invisible, not
 * merely inaccessible — the list must not even reveal that they exist.
 */
export async function listConversations(args: {
  organizationId: string;
  userId: string | null;
  limit?: number;
}): Promise<AskConversation[]> {
  const params: unknown[] = [args.organizationId];
  const predicate = userPredicate(args.userId, params);
  params.push(Math.min(args.limit ?? 50, 100));
  const result = await pg.query<AskConversation>(
    `SELECT id, title, mode, last_message_at
       FROM ask_conversations
      WHERE organization_id = $1 AND ${predicate}
      ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC
      LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export type AskMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Verified-claims structure from the provenance pass; null on user turns. */
  claims: unknown;
  /**
   * Provenance lifecycle: NULL (never applicable) | pending | complete |
   * partial | failed. The UI needs this to distinguish "no citations because
   * decomposition is still running" from "no citations because none were
   * possible" — rendering both as a bare uncited answer is what lets an
   * unverified answer look verified.
   */
  provenance_status: string | null;
  created_at: string;
};

/**
 * A thread's messages for rendering, oldest first, bounded.
 *
 * Includes `claims` so the UI can show an answer's citations exactly as they
 * were verified at answer time — provenance is replayed from the record, never
 * recomputed. Ownership must already be established via findOwnedConversation;
 * this function does not re-check it.
 */
export async function loadMessages(args: {
  organizationId: string;
  conversationId: string;
  limit?: number;
}): Promise<AskMessage[]> {
  const limit = Math.min(args.limit ?? 100, 200);
  const result = await pg.query<AskMessage>(
    `SELECT id, role, content, claims, provenance_status, created_at FROM (
       SELECT id, role, content, claims, provenance_status, created_at
         FROM ask_messages
        WHERE conversation_id = $1 AND organization_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [args.conversationId, args.organizationId, limit]
  );
  return result.rows;
}

export async function recordUserMessage(args: {
  organizationId: string;
  conversationId: string;
  userId: string | null;
  content: string;
}): Promise<string> {
  const result = await pg.query<{ id: string }>(
    `INSERT INTO ask_messages (organization_id, conversation_id, user_id, role, content)
     VALUES ($1, $2, $3, 'user', $4)
     RETURNING id`,
    [args.organizationId, args.conversationId, args.userId, args.content]
  );
  return result.rows[0]!.id;
}

/**
 * Persist an assistant turn together with the tool invocations that produced it,
 * then stamp the conversation.
 *
 * The invocations are written in the SAME call as the message they belong to, so
 * an answer can never exist without its evidence chain. They are the provenance
 * substrate: a citation points at one of these rows.
 */
export async function recordAssistantMessage(args: {
  organizationId: string;
  conversationId: string;
  userId: string | null;
  content: string;
  modelId: string;
  promptVersion: string;
  claims?: unknown;
  invocations: RecordedInvocation[];
  /**
   * Provenance lifecycle for this turn. NULL means never applicable (no
   * retrieval, or the feature is off) — it is not a state, and must not render
   * as one. 'pending' means decomposition was deferred to the async worker.
   */
  provenanceStatus?: "pending" | "complete" | "partial" | null;
}): Promise<string> {
  const messageResult = await pg.query<{ id: string }>(
    `INSERT INTO ask_messages
       (organization_id, conversation_id, user_id, role, content, claims, model_id,
        prompt_version, provenance_status)
     VALUES ($1, $2, $3, 'assistant', $4, $5::jsonb, $6, $7, $8)
     RETURNING id`,
    [
      args.organizationId,
      args.conversationId,
      args.userId,
      args.content,
      args.claims === undefined ? null : JSON.stringify(args.claims),
      args.modelId,
      args.promptVersion,
      args.provenanceStatus ?? null,
    ]
  );
  const messageId = messageResult.rows[0]!.id;

  for (const inv of args.invocations) {
    await pg.query(
      `INSERT INTO ask_tool_invocations
         (organization_id, message_id, tool_name, action_class, input,
          output_digest, authorized, status_code, error_code, latency_ms)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
      [
        args.organizationId,
        messageId,
        inv.toolName,
        inv.actionClass,
        JSON.stringify(inv.input ?? {}),
        inv.outputDigest === null ? null : JSON.stringify(inv.outputDigest),
        inv.authorized,
        inv.statusCode,
        inv.errorCode,
        inv.latencyMs,
      ]
    );
  }

  await pg.query(
    `UPDATE ask_conversations
        SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [args.conversationId, args.organizationId]
  );

  return messageId;
}
