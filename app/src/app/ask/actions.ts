"use server";

import { getSession } from "@/lib/session";
import {
  askQuestion,
  listAskConversations,
  getAskConversation,
  confirmAskAction,
  type AskResponse,
  type AskResult,
  type AskConfirmResult,
  type AskConversationSummary,
  type AskConversationDetail,
} from "@/lib/api";

// Mirror AskResult so the client can switch on the same shape regardless
// of whether the failure originated in the API client (network, parse) or
// in the engine (HTTP error with body). Auth failures here are reported
// with code: "unauthorized" so the client maps them through the same
// error-message table as engine-side errors.
export type AskActionResult = AskResult;

export async function askAction(
  question: string,
  conversationId?: string | null
): Promise<AskActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Not authenticated",
    };
  }
  return askQuestion(token, question, conversationId ?? null);
}

/**
 * The caller's own Ask threads, newest-activity first (engine ordering).
 *
 * Returns null on any failure — no auth, engine error, or an engine build
 * without the conversation routes. The client treats null and an empty list
 * identically: single-shot Ask, no sidebar, no error. Thread history is an
 * enhancement, never a failure mode.
 */
export async function listConversationsAction(): Promise<
  { conversations: AskConversationSummary[] } | null
> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) return null;
  return listAskConversations(token);
}

/**
 * One owned thread with its transcript. Null covers not-found, not-owned
 * (indistinguishable by engine contract), and any failure.
 */
export async function getConversationAction(
  conversationId: string
): Promise<AskConversationDetail | null> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) return null;
  return getAskConversation(token, conversationId);
}

/**
 * Confirm or decline a proposed mutation (ASK-B). The proposal token is
 * passed through verbatim and never logged — it is the single-use credential
 * that executes (or retires) the exact server-frozen change.
 */
export async function resolveProposalAction(
  proposalToken: string,
  decision: "confirm" | "decline"
): Promise<AskConfirmResult> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) {
    return { ok: false, status: 401, code: "unauthorized", message: "Not authenticated" };
  }
  return confirmAskAction(token, proposalToken, decision);
}

export type { AskResponse };
export type { AskConversationSummary, AskConversationDetail };
export type { AskConfirmResult };
