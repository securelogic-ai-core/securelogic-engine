"use client";

/**
 * /portal/clarifications — the two-sided message thread with the reviewer.
 *
 * GET /comments returns only vendor-visible messages (the engine filters
 * visibility in SQL); POST /comments sends a vendor message. Oldest first,
 * newest last. The engine identifies sides as "you" / "reviewer" — internal
 * reviewer identities are only shown when the organization chose to disclose
 * a display name.
 *
 * Note the engine's semantics: sending a message does NOT reopen a
 * clarification-requested questionnaire — only a real change to the
 * submission (an answer or attachment) does.
 */

import { useCallback, useEffect, useState } from "react";
import { usePortal } from "../PortalShell";
import {
  errorMessage,
  formatDateTime,
  portalFetch,
  type PortalMessage,
} from "../portalApi";

type LoadState = "loading" | "error" | "ready";

export default function ClarificationsPage() {
  const { onUnauthorized } = usePortal();
  const [load, setLoad] = useState<LoadState>("loading");
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [acceptingMessages, setAcceptingMessages] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await portalFetch<{
        messages: PortalMessage[];
        accepting_messages: boolean;
      }>("/comments");
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (!result.ok || !result.body) {
        setLoad("error");
        return;
      }
      setMessages(result.body.messages);
      setAcceptingMessages(result.body.accepting_messages);
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (draft.trim().length === 0) {
      setSendError("Enter a message before sending.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const result = await portalFetch<{ id: string }>("/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (result.status !== 201) {
        // 400 (empty/too long/limit reached) and 409 (thread closed) carry
        // the engine's own explanation — show it verbatim.
        setSendError(errorMessage(result, "Your message could not be sent. Please try again."));
        if (result.status === 409) await refresh();
        return;
      }
      setDraft("");
      await refresh();
    } catch {
      setSendError("Network problem — your message was not sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (load === "loading") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8 text-sm text-slate-400">
        Loading messages…
      </div>
    );
  }

  if (load === "error") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <p className="text-sm text-slate-300">We could not load the message thread.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-brand-line bg-brand-surface p-6">
        <h2 className="text-base font-semibold text-slate-100">Messages</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Use this thread to ask the reviewer questions, or to respond when they ask you for
          clarification. Both sides see every message here.
        </p>
      </section>

      {/* Thread — oldest first, newest last */}
      {messages.length === 0 ? (
        <div className="rounded-xl border border-brand-line bg-brand-surface p-6 text-sm text-slate-400">
          No messages yet.
        </div>
      ) : (
        <ol className="space-y-3">
          {messages.map((m) => {
            const mine = m.from === "you";
            return (
              <li key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    "max-w-[85%] rounded-xl border p-4 " +
                    (mine
                      ? "border-brand-teal/40 bg-brand-teal/10"
                      : "border-brand-line bg-brand-surface")
                  }
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span
                      className={
                        "text-xs font-semibold " + (mine ? "text-brand-teal" : "text-slate-300")
                      }
                    >
                      {mine ? "You" : m.author_name ?? "Reviewer"}
                    </span>
                    <span className="text-[10px] text-slate-500">{formatDateTime(m.sent_at)}</span>
                    {m.requirement_reference && (
                      <span className="rounded border border-brand-line px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {m.requirement_reference}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{m.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Composer */}
      {acceptingMessages ? (
        <form
          onSubmit={(e) => void handleSend(e)}
          className="rounded-xl border border-brand-line bg-brand-surface p-5"
        >
          <label
            htmlFor="message-draft"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Send a message
          </label>
          <textarea
            id="message-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={8000}
            rows={3}
            placeholder="Write your message to the reviewer…"
            className="w-full rounded-lg border border-brand-line bg-brand-bg p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-teal focus:outline-none"
          />
          {sendError && (
            <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs leading-5 text-red-300">
              {sendError}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={sending}
              className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-sm leading-6 text-slate-300">
          This conversation is closed. If you need to reach the organization, please contact
          your reviewer directly.
        </div>
      )}
    </div>
  );
}
