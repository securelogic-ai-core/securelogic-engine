"use client";

/**
 * FindingStatusButtons.tsx — the Finding detail status controls.
 *
 * These used to be server-action <form>s that AWAITED the action and threw the result away.
 * So when the engine refused a close (409 close_requires_remediation_complete), the page
 * re-rendered unchanged and the customer saw NOTHING: no message, no error, no clue. The
 * button simply did not work, which is the worst possible way for a rule to be enforced —
 * indistinguishable, from the customer's side, from a bug.
 *
 * A client component, because refusal is a real outcome that has to be shown. Server-side
 * enforcement is unchanged and remains the authority; this only reports it.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { updateFindingStatusAction } from "./actions";
import type { FindingActionError } from "@/lib/findingClosureError";

type Transition = { to: string; label: string };

export function FindingStatusButtons({
  findingId,
  transitions,
  /**
   * Blocking remediation the PAGE already knows about. When it is non-zero we relabel the
   * closing controls up front rather than inviting a click we know the server will refuse.
   * Enforcement still happens server-side — this is courtesy, not security.
   */
  openActionCount = 0,
}: {
  findingId: string;
  transitions: Transition[];
  openActionCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<FindingActionError | null>(null);

  const blocked = openActionCount > 0;
  const isClosing = (to: string) => to === "closed" || to === "accepted";

  function run(to: string) {
    setFailure(null);
    startTransition(async () => {
      const result = await updateFindingStatusAction(findingId, to);
      if (result && "error" in result && result.error) {
        setFailure(result as FindingActionError);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        {transitions.map((t) => {
          // Relabel, do not hide: a customer must still be able to see that closing is a
          // thing this Finding can eventually do, and why it cannot right now.
          const gated = blocked && isClosing(t.to);
          return (
            <button
              key={t.to}
              type="button"
              disabled={pending || gated}
              title={
                gated
                  ? `${openActionCount} remediation item${openActionCount === 1 ? "" : "s"} must be completed first`
                  : undefined
              }
              onClick={() => run(t.to)}
              className="text-xs font-medium transition-colors"
              style={{
                border: "1px solid #1e293b",
                color: gated ? "#475569" : "#94a3b8",
                padding: "3px 10px",
                borderRadius: "6px",
                background: "transparent",
                cursor: pending || gated ? "not-allowed" : "pointer",
              }}
            >
              {gated ? `${t.label} (remediation open)` : t.label}
            </button>
          );
        })}
      </div>

      {blocked && (
        <p className="text-xs mb-3" style={{ color: "#94a3b8" }}>
          Complete the remaining required remediation before closing this Finding.{" "}
          {openActionCount} remediation item{openActionCount === 1 ? "" : "s"} remain
          {openActionCount === 1 ? "s" : ""} open.
        </p>
      )}

      {failure?.error && (
        <p className="text-xs mb-3" style={{ color: "#fca5a5" }}>
          {failure.error}{" "}
          {failure.remediationHref && (
            <Link href={failure.remediationHref} className="underline" style={{ color: "#93c5fd" }}>
              View remediation
            </Link>
          )}
        </p>
      )}
    </>
  );
}
