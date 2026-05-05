"use client";

import type { TimedNotice } from "@/hooks/useTimedNotice";

/**
 * Per-page toast for the matcher queue UI. Renders the active notice from
 * useTimedNotice, with an optional action button (used by SuggestionList
 * to expose the 5-second undo).
 *
 * Visual style is intentionally muted — this is feedback, not an alert.
 * Position is fixed to the bottom-right of the queue page; the queue page
 * is responsible for mounting <Notice /> exactly once.
 */
export function Notice({
  notice,
  onAction,
  onDismiss,
}: {
  notice: TimedNotice | null;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  if (notice === null) return null;

  const handleAction = () => {
    if (notice.onAction) notice.onAction();
    if (onAction) onAction();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "#0f1722",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        color: "#e5e7eb",
        fontSize: 14,
        boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        zIndex: 50,
      }}
    >
      <span>{notice.message}</span>
      {notice.actionLabel && notice.onAction ? (
        <button
          type="button"
          onClick={handleAction}
          style={{
            background: "transparent",
            border: "none",
            color: "#60a5fa",
            cursor: "pointer",
            fontWeight: 500,
            padding: 0,
          }}
        >
          {notice.actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          background: "transparent",
          border: "none",
          color: "#9ca3af",
          cursor: "pointer",
          padding: 0,
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
