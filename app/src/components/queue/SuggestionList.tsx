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
import { queueIntelligenceHref } from "@/lib/intelligenceLinks";
import {
  acceptSuggestionAction,
  dismissSuggestionAction,
  bulkDecideSuggestionsAction,
} from "@/app/actions/signalMatchSuggestion";
import {
  toggleSelection,
  isAllSelected,
  toggleSelectAll,
  pruneSelection,
  summarizeBulkResult,
  partitionAcceptEligible,
} from "./bulkSelection";
import { useTimedNotice } from "@/hooks/useTimedNotice";
import { Notice } from "./Notice";
import {
  confidenceBand,
  describeMatchReason,
  signalHeadline,
  type ConfidenceTone,
} from "./reviewLanguage";

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
  asset:      "Asset",
};

const TARGET_ROUTE: Record<SignalMatchTargetType, string> = {
  vendor:     "/vendors",
  ai_system:  "/ai-systems",
  control:    "/controls",
  obligation: "/obligations",
  asset:      "/assets",
};

/**
 * EAR Phase 2: accepting an asset suggestion means writing a link row, and
 * the registry link-store shape is a Phase-3 decision — the engine refuses
 * with 409 asset_target_accept_unsupported. The UI therefore never offers
 * Accept for asset rows (a button that always errors is a dead end); Dismiss
 * works normally. Flips to true for everything else.
 */
export function isAcceptSupported(targetType: SignalMatchTargetType): boolean {
  return targetType !== "asset";
}

export type EnrichedSuggestion = SignalMatchSuggestion & {
  // Server-rendered enrichments — joined into the row at page-load time
  // so the list itself is dumb. Optional because legacy rows or partial
  // joins may be missing fields.
  target_name?: string | null;
  // Legacy field names read by the pre-workspace row layout. The engine list
  // endpoint does NOT return these (it returns event_* below), so today they are
  // undefined and the legacy row falls back to a truncated signal UUID. Kept so
  // the flag-off render path is byte-for-byte unchanged (GATE B).
  signal_title?: string | null;
  signal_severity?: string | null;
  signal_source?: string | null;
  signal_cve?: string | null;
  // Canonical Intelligence Event enrichment actually returned by the engine
  // (SUGGESTION_ENRICHED_SELECT: ie.title/severity/confidence/canonical_key).
  // Populated when the Intelligence Events layer is on; null when dark. The
  // workspace "Review Suggested Links" layout consumes these.
  intelligence_event_id?: string | null;
  event_title?: string | null;
  event_severity?: string | null;
  event_confidence?: number | null;
  event_canonical_key?: string | null;
};

export function SuggestionList({
  initialSuggestions,
  embeddedRevalidatePath,
  emptyState,
  workspace = false,
}: {
  initialSuggestions: EnrichedSuggestion[];
  // Set when the list is mounted on a vendor/ai_system/control/obligation
  // detail page so the action revalidates that page in addition to /queue.
  embeddedRevalidatePath?: string;
  // Rendered when initialSuggestions is empty. The page decides which
  // empty state copy to show (filtered-empty vs first-time-empty).
  emptyState: React.ReactNode;
  // When true (risk_workspace flag on), render the "Review Suggested Links"
  // enterprise layout: business language, confidence bands, intelligence-event
  // titles — no raw signal IDs or match_reason codes. Off = legacy layout,
  // byte-for-byte unchanged (GATE B).
  workspace?: boolean;
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

      // Accept must not end in a dead-end toast: name the entity the link
      // landed on and offer the path to it. Navigating during the undo window
      // commits the accept (unmount semantics above) — safe by design.
      const suggestion = initialSuggestions.find((s) => s.id === suggestionId);
      const outcome =
        kind === "accept" && suggestion
          ? {
              message: `Linked to ${suggestion.target_name ?? "the selected record"}`,
              href: `${TARGET_ROUTE[suggestion.target_type]}/${suggestion.target_id}`,
              hrefLabel: `View ${TARGET_LABEL[suggestion.target_type] ?? "record"} →`,
            }
          : null;

      showNotice({
        id: `pending-${suggestionId}-${kind}`,
        message: outcome?.message ?? (kind === "accept" ? "Suggestion accepted" : "Suggestion dismissed"),
        href: outcome?.href,
        hrefLabel: outcome?.hrefLabel,
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
    [cancelTimer, commitAccept, commitDismiss, dismissNotice, showNotice, initialSuggestions]
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

  // Bulk "Select mode" (ERIP §3) — an OPT-IN mode, mutually exclusive with the
  // per-row undo timers above (in select mode the row shows a checkbox, not
  // Accept/Dismiss). Only offered under the workspace reskin; legacy is untouched.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPending, startBulk] = useTransition();
  const visibleIds = useMemo(() => visible.map((s) => s.id), [visible]);

  // Keep the selection to still-visible rows (e.g. after a refresh).
  useEffect(() => {
    setSelected((cur) => {
      const pruned = pruneSelection(cur, visibleIds);
      return pruned.length === cur.length ? cur : pruned;
    });
  }, [visibleIds]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected([]);
  }, []);

  const runBulk = useCallback(
    (decision: "accept" | "dismiss") => {
      if (selected.length === 0) return;
      // Bulk ACCEPT never sends asset rows — the engine refuses them (409)
      // until the registry link store ships, so sending them only manufactures
      // partial failures. They stay selected-and-skipped, called out in the
      // notice. Dismiss takes everything.
      const { eligible, skipped } =
        decision === "accept"
          ? partitionAcceptEligible(
              selected,
              new Map(initialSuggestions.map((s) => [s.id, s.target_type]))
            )
          : { eligible: [...selected], skipped: [] as string[] };
      if (eligible.length === 0) {
        showNotice({
          id: `bulk-${decision}-none`,
          message: summarizeBulkResult(decision, 0, 0, skipped.length),
        });
        exitSelectMode();
        return;
      }
      startBulk(async () => {
        const res = await bulkDecideSuggestionsAction(eligible, decision, { embeddedRevalidatePath });
        showNotice({
          id: `bulk-${decision}-${eligible.length}`,
          message: summarizeBulkResult(
            decision,
            res.succeeded.length,
            res.failed.length,
            skipped.length
          ),
        });
        exitSelectMode();
        router.refresh();
      });
    },
    [selected, initialSuggestions, embeddedRevalidatePath, showNotice, exitSelectMode, router]
  );

  if (initialSuggestions.length === 0) {
    return <>{emptyState}</>;
  }

  const allSelected = isAllSelected(selected, visibleIds);

  return (
    <>
      {/* Bulk toolbar — workspace reskin only (legacy queue unchanged). */}
      {workspace && visible.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          {!selectMode ? (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              style={{ fontSize: 13, color: "#94a3b8", border: "1px solid #1e293b", borderRadius: 8, padding: "5px 12px", background: "transparent" }}
            >
              Select
            </button>
          ) : (
            <>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#cbd5e1" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected((cur) => toggleSelectAll(cur, visibleIds))}
                  aria-label="Select all visible suggestions"
                />
                {allSelected ? "Clear all" : `Select all (${visibleIds.length})`}
              </label>
              <span style={{ fontSize: 13, color: "#64748b" }}>{selected.length} selected</span>
              <button
                type="button"
                onClick={exitSelectMode}
                style={{ fontSize: 13, color: "#64748b", border: "1px solid #1e293b", borderRadius: 8, padding: "5px 12px", background: "transparent" }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

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
              workspace={workspace}
              selectMode={selectMode}
              checked={selected.includes(s.id)}
              onToggleSelect={() => setSelected((cur) => toggleSelection(cur, s.id))}
              onAccept={() => beginPending(s.id, "accept")}
              onDismiss={() => beginPending(s.id, "dismiss")}
            />
          ))}
        </ul>
      )}

      {/* Sticky bulk action bar when a selection exists. */}
      {selectMode && selected.length > 0 && (
        <div
          style={{
            position: "sticky",
            bottom: 16,
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 16px",
            borderRadius: 12,
            background: "rgba(15,23,42,0.96)",
            border: "1px solid #1e293b",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ fontSize: 13, color: "#cbd5e1" }}>{selected.length} selected</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={bulkPending}
              onClick={() => runBulk("dismiss")}
              style={{ fontSize: 13, fontWeight: 600, color: "#fca5a5", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "7px 14px", opacity: bulkPending ? 0.6 : 1 }}
            >
              {bulkPending ? "Working…" : "Dismiss selected"}
            </button>
            <button
              type="button"
              disabled={bulkPending}
              onClick={() => runBulk("accept")}
              style={{ fontSize: 13, fontWeight: 600, color: "#00c4b4", background: "rgba(0,196,180,0.12)", border: "1px solid rgba(0,196,180,0.4)", borderRadius: 8, padding: "7px 14px", opacity: bulkPending ? 0.6 : 1 }}
            >
              {bulkPending ? "Working…" : "Accept selected"}
            </button>
          </div>
        </div>
      )}

      <Notice notice={notice} onDismiss={dismissNotice} />
    </>
  );
}

const CONFIDENCE_COLOR: Record<ConfidenceTone, string> = {
  high: "#fca5a5",
  medium: "#fcd34d",
  low: "#86efac",
};

function SuggestionRow({
  suggestion,
  workspace,
  selectMode = false,
  checked = false,
  onToggleSelect,
  onAccept,
  onDismiss,
}: {
  suggestion: EnrichedSuggestion;
  workspace: boolean;
  selectMode?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const targetHref = `${TARGET_ROUTE[suggestion.target_type]}/${suggestion.target_id}`;
  const score = suggestion.match_score;
  const band = confidenceBand(score);

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
          {workspace ? (
            band ? (
              <span
                title={`SecureLogic's confidence that this signal applies (match score ${score}/100).`}
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  color: CONFIDENCE_COLOR[band.tone],
                  padding: "2px 8px",
                  border: `1px solid ${CONFIDENCE_COLOR[band.tone]}`,
                  borderRadius: 999,
                }}
              >
                {band.label}
              </span>
            ) : null
          ) : score !== null ? (
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

        {workspace ? (
          <>
            <div style={{ fontSize: 13, color: "#d1d5db" }}>
              {signalHeadline(suggestion.event_title)}
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
              {suggestion.event_severity ? <span>Severity: {suggestion.event_severity}</span> : null}
              {suggestion.event_canonical_key ? <span>{suggestion.event_canonical_key}</span> : null}
              <span>Why: {describeMatchReason(suggestion.match_reason, suggestion.target_type)}</span>
              {(() => {
                // Reciprocal drill-through to the canonical intelligence event —
                // workspace reskin only, and only when the row carries an event id.
                const href = queueIntelligenceHref(workspace, suggestion.intelligence_event_id);
                return href ? (
                  <Link href={href} style={{ color: "#93c5fd" }}>View intelligence</Link>
                ) : null;
              })()}
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {selectMode ? (
        <div style={{ display: "flex", alignItems: "flex-start", paddingTop: 2 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleSelect}
            aria-label={`Select suggested link for ${suggestion.target_name ?? suggestion.target_id}`}
            style={{ width: 18, height: 18, cursor: "pointer" }}
          />
        </div>
      ) : (
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
          {isAcceptSupported(suggestion.target_type) ? (
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
          ) : (
            <span
              title="Accepting asset suggestions arrives with the asset link store. Dismiss works today."
              style={{
                fontSize: 12,
                color: "#9ca3af",
                border: "1px dashed rgba(255,255,255,0.16)",
                borderRadius: 6,
                padding: "6px 12px",
                alignSelf: "center",
              }}
            >
              Accept coming soon
            </span>
          )}
        </div>
      )}
    </li>
  );
}
