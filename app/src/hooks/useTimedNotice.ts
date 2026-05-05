"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TimedNotice = {
  id: string;
  message: string;
  // The action label and callback are optional — undo notices use them,
  // generic toasts (e.g. an error) leave them undefined.
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Per-page transient notice with a fixed TTL. Scoped to the queue UI by
 * convention — the hook itself is generic, but the matching <Notice />
 * component lives under app/src/components/queue.
 *
 * One active notice at a time. Calling show() while a notice is visible
 * replaces it (and clears any pending dismissal timer). Calling dismiss()
 * or invoking the action button hides it immediately.
 *
 * The hook does NOT persist anything to a global store. If the user closes
 * the tab during the TTL window, no event fires — the queue's accept/dismiss
 * server actions have already committed by the time the notice appears, so
 * "closed tab during 5s window" semantics apply only to undo (see
 * SuggestionList for the optimistic-commit timer pattern).
 */
export function useTimedNotice(ttlMs = 5000): {
  notice: TimedNotice | null;
  show: (notice: TimedNotice) => void;
  dismiss: () => void;
} {
  const [notice, setNotice] = useState<TimedNotice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setNotice(null);
  }, [clearTimer]);

  const show = useCallback(
    (next: TimedNotice) => {
      clearTimer();
      setNotice(next);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setNotice((current) => (current?.id === next.id ? null : current));
      }, ttlMs);
    },
    [clearTimer, ttlMs]
  );

  useEffect(() => clearTimer, [clearTimer]);

  return { notice, show, dismiss };
}
