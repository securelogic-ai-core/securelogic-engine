"use client";

/**
 * SuggestionList — interactive list view for the matcher queue.
 *
 * Concurrency model
 * -----------------
 * Each row has a per-row state machine:
 *
 *   idle ──[click Accept]──► pending-accept ──5s──► committed (server action runs)
 *      │                            │
 *      │                            └──[click Undo]──► idle
 *      │
 *      └──[click Dismiss]──► pending-dismiss ──5s──► committed (server action runs)
 *                                   │
 *                                   └──[click Undo]──► idle
 *
 * The 5-second window is a local-only undo buffer: the row stays mounted,
 * the suggestion is hidden from the visible list, and a Notice exposes the
 * undo button. If the user closes the tab during this window, NO server
 * call has fired yet — by design, per the design-decisions doc. To make
 * "intent to commit" durable on tab-close, the cleanup hook below fires
 * pending timers immediately on unmount instead of cancelling them.
 *
 * Timers are tracked in a Map<suggestionId, TimeoutHandle> at the component
 * level rather than in per-row state. Two reasons:
 *   1. A user can accept/dismiss several rows in rapid succession — each
 *      row's timer must coexist independently.
 *   2. Cleanup on unmount needs to walk every pending timer at once. A
 *      Map keyed by suggestionId is the simplest data structure that gives
 *      O(1) cancel-and-replace (when undo is hit) and O(N) drain on unmount.
 *
 * The state machine is per-row, but the cleanup boundary is component-wide.
 *
 * The list itself is given an initial set of suggestions from the server-
 * rendered page (no client-side fetch). After every commit, the server
 * action revalidates /queue, so a Next.js soft refresh re-fetches.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  SignalMatchSuggestion,
  SignalMatchTargetType,
} from "@/lib/api";
import {
  acceptSuggestionAction,
  dismissSuggestionAction,
} from "@/app/actions/signalMatchSuggestion";
import { useTimedNotice } from "@/hooks/useTimedNotice";
import { Notice } from "./Notice";

const UNDO_WINDOW_MS = 5000;

type RowState =
  | { kind: "idle" }
  | { kind: "pending-accept" }
  | { kind: "pending-dismiss" };

const TARGET_LABEL: Record<SignalMatchTargetType, string> = {
  vendor:     "Vendor",
  ai_system:  "AI System",
  control:    "Control",
  obligation: "Obligation",
};

const TARGET_ROUTE: Record<SignalMatchTargetType, string> = {
  vendor:     "/vendors",
  ai_system:  "/ai-systems",
  control:    "/controls",
  obligation: "/obligations",
};

export type EnrichedSuggestion = SignalMatchSuggestion & {
  // Server-rendered enrichments — joined into the row at page-load time
  // so the list itself is dumb. Optional because legacy rows or partial
  // joins may be missing fields.
  signal_title?: string | null;
  signal_severity?: string | null;
  signal_source?: string | null;
  signal_cve?: string | null;
  target_name?: string | null;
};

export function SuggestionList({
  initialSuggestions,
  embeddedRevalidatePath,
  emptyState,
}: {
  initialSuggestions: EnrichedSuggestion[];
  // Set when the list is mounted on a vendor/ai_system/control/obligation
  // detail page so the action revalidates that page in addition to /queue.
  embeddedRevalidatePath?: string;
  // Rendered when initialSuggestions is empty. The page decides which
  // empty state copy to show (filtered-empty vs first-time-empty).
  emptyState: React.ReactNode;
}) {
  const router = useRouter();
  const { notice, show: showNotice, dismiss: dismissNotice } = useTimedNotice(UNDO_WINDOW_MS);
  const [, startTransition] = useTransition();

  const [rowState, setRowState] = useState<Map<string, RowState>>(() => new Map());

  // Map<suggestionId, TimeoutHandle>. Component-wide so unmount cleanup
  // can drain every pending timer in one pass. NOT in React state — the
  // map's identity never changes and mutations of it should not trigger
  // re-renders (the visible state lives in rowState above).
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Latest pending intents per row, captured so the unmount-drain hook
  // can run the right server action without reading stale closures. Keyed
  // by suggestionId; deleted when the timer fires or undo is clicked.
  const pendingIntentRef = useRef<
    Map<string, { kind: "accept" | "dismiss" }>
  >(new Map());

  // Mirror the embeddedRevalidatePath prop into a ref so the unmount-only
  // cleanup hook below can read the latest value with a [] deps array. If
  // we put the prop directly in the deps, React would tear down and
  // re-create the effect on every prop change, draining pending timers
  // mid-session — exactly the wrong moment to commit.
  const embeddedRevalidatePathRef = useRef<string | undefined>(embeddedRevalidatePath);
  useEffect(() => {
    embeddedRevalidatePathRef.current = embeddedRevalidatePath;
  }, [embeddedRevalidatePath]);

  const commitAccept = useCallback(
    (suggestionId: string) => {
      startTransition(async () => {
        const result = await acceptSuggestionAction(suggestionId, {
          embeddedRevalidatePath,
        });
        if (!result.ok) {
          // Surface the server error and roll the row back to idle so the
          // user can retry. This is the only failure path that re-mounts
          // the suggestion in the visible list — revalidatePath would not
          // have run because the action returned !ok.
          showNotice({
            id: `error-${suggestionId}`,
            message: `Could not accept: ${result.error}`,
          });
          setRowState((prev) => {
            const next = new Map(prev);
            next.set(suggestionId, { kind: "idle" });
            return next;
          });
        } else {
          router.refresh();
        }
      });
    },
    [embeddedRevalidatePath, router, showNotice]
  );

  const commitDismiss = useCallback(
    (suggestionId: string) => {
      startTransition(async () => {
        const result = await dismissSuggestionAction(suggestionId, {
          embeddedRevalidatePath,
        });
        if (!result.ok) {
          showNotice({
            id: `error-${suggestionId}`,
            message: `Could not dismiss: ${result.error}`,
          });
          setRowState((prev) => {
            const next = new Map(prev);
            next.set(suggestionId, { kind: "idle" });
            return next;
          });
        } else {
          router.refresh();
        }
      });
    },
    [embeddedRevalidatePath, router, showNotice]
  );

  const cancelTimer = useCallback((suggestionId: string) => {
    const handle = timersRef.current.get(suggestionId);
    if (handle !== undefined) {
      clearTimeout(handle);
      timersRef.current.delete(suggestionId);
    }
    pendingIntentRef.current.delete(suggestionId);
  }, []);

  const beginPending = useCallback(
    (suggestionId: string, kind: "accept" | "dismiss") => {
      cancelTimer(suggestionId);
      pendingIntentRef.current.set(suggestionId, { kind });
      setRowState((prev) => {
        const next = new Map(prev);
        next.set(
          suggestionId,
          kind === "accept" ? { kind: "pending-accept" } : { kind: "pending-dismiss" }
        );
        return next;
      });
      const handle = setTimeout(() => {
        timersRef.current.delete(suggestionId);
        pendingIntentRef.current.delete(suggestionId);
        if (kind === "accept") commitAccept(suggestionId);
        else commitDismiss(suggestionId);
      }, UNDO_WINDOW_MS);
      timersRef.current.set(suggestionId, handle);

      showNotice({
        id: `pending-${suggestionId}-${kind}`,
        message:
          kind === "accept" ? "Suggestion accepted" : "Suggestion dismissed",
        actionLabel: "Undo",
        onAction: () => {
          cancelTimer(suggestionId);
          setRowState((prev) => {
            const next = new Map(prev);
            next.set(suggestionId, { kind: "idle" });
            return next;
          });
          dismissNotice();
        },
      });
    },
    [cancelTimer, commitAccept, commitDismiss, dismissNotice, showNotice]
  );

  // Component-wide unmount cleanup. Per the design-decisions doc, we DO NOT
  // cancel pending timers on unmount — the user's intent was already
  // captured when they clicked Accept/Dismiss; quietly cancelling on a
  // route change would silently lose work. Instead, fire each pending
  // server action immediately. The 5-second undo only protects the user
  // when the component is still mounted; navigating away commits.
  //
  // Empty deps array is deliberate: this hook must run exactly once on
  // mount and exactly once on unmount. embeddedRevalidatePath is read
  // through a ref above; putting it in the deps would make React tear
  // down and re-create the effect on every prop change, draining timers
  // mid-session.
  useEffect(() => {
    const timers = timersRef.current;
    const pending = pendingIntentRef.current;
    return () => {
      const path = embeddedRevalidatePathRef.current;
      for (const [suggestionId, handle] of timers.entries()) {
        clearTimeout(handle);
        const intent = pending.get(suggestionId);
        if (intent === undefined) continue;
        // Fire-and-forget: the server actions above use revalidatePath,
        // and this code path only runs on unmount. We cannot startTransition
        // here (no React tree), so call the action directly.
        if (intent.kind === "accept") {
          void acceptSuggestionAction(suggestionId, { embeddedRevalidatePath: path });
        } else {
          void dismissSuggestionAction(suggestionId, { embeddedRevalidatePath: path });
        }
      }
      timers.clear();
      pending.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(
    () =>
      initialSuggestions.filter((s) => {
        const state = rowState.get(s.id);
        // Hide rows that are pending-accept or pending-dismiss — they
        // visually leave the list immediately and only return on undo.
        return state === undefined || state.kind === "idle";
      }),
    [initialSuggestions, rowState]
  );

  if (initialSuggestions.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {visible.length === 0 ? (
        <div
          style={{
            padding: 24,
            color: "#9ca3af",
            fontSize: 14,
            border: "1px dashed rgba(255,255,255,0.12)",
            borderRadius: 8,
          }}
        >
          All visible suggestions have been actioned. Use Undo if that wasn't
          intended.
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {visible.map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              onAccept={() => beginPending(s.id, "accept")}
              onDismiss={() => beginPending(s.id, "dismiss")}
            />
          ))}
        </ul>
      )}
      <Notice notice={notice} onDismiss={dismissNotice} />
    </>
  );
}

function SuggestionRow({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: EnrichedSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const targetHref = `${TARGET_ROUTE[suggestion.target_type]}/${suggestion.target_id}`;
  const score = suggestion.match_score;

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        padding: 16,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "#9ca3af",
              padding: "2px 8px",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 999,
            }}
          >
            {TARGET_LABEL[suggestion.target_type]}
          </span>
          <Link
            href={targetHref}
            style={{ color: "#e5e7eb", fontWeight: 600, textDecoration: "none" }}
          >
            {suggestion.target_name ?? suggestion.target_id}
          </Link>
          {score !== null ? (
            <span
              title="Match score (0–100). Higher = more confidence the signal applies."
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: score >= 70 ? "#fca5a5" : score >= 40 ? "#fcd34d" : "#86efac",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {score}
            </span>
          ) : null}
        </div>

        <div style={{ fontSize: 13, color: "#d1d5db" }}>
          {suggestion.signal_title ?? `Signal ${suggestion.signal_id.slice(0, 8)}…`}
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#9ca3af",
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {suggestion.signal_source ? <span>Source: {suggestion.signal_source}</span> : null}
          {suggestion.signal_severity ? <span>Severity: {suggestion.signal_severity}</span> : null}
          {suggestion.signal_cve ? <span>{suggestion.signal_cve}</span> : null}
          {suggestion.match_reason ? <span>Match: {suggestion.match_reason}</span> : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.16)",
            color: "#d1d5db",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onAccept}
          style={{
            background: "#2563eb",
            border: "1px solid #1d4ed8",
            color: "white",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Accept
        </button>
      </div>
    </li>
  );
}
