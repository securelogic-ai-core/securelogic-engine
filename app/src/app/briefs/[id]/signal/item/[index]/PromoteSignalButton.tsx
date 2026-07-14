"use client";

import { useState, useTransition } from "react";
import { promoteSignalToFindingAction } from "./actions";

/**
 * "Create a finding from this intelligence" — the Brief → Finding hop.
 *
 * Every state is visible to the reader: idle, in-flight, and failed. A creation
 * control that silently does nothing on failure is worse than no control, because
 * the reader walks away believing the finding exists. On success the server action
 * redirects into the new finding's Decision Workspace, so this component does not
 * render a success state — the destination IS the success state.
 */
export default function PromoteSignalButton({ signalId }: { signalId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await promoteSignalToFindingAction(signalId);
            // A successful action redirects (it throws to navigate) and never returns,
            // so anything with an `error` here is a genuine failure worth showing.
            if (result?.error) setError(result.error);
          });
        }}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: "rgba(0,196,180,0.12)",
          color: "#00c4b4",
          border: "1px solid rgba(0,196,180,0.4)",
        }}
      >
        {pending ? "Creating finding…" : "Create a finding from this intelligence →"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </div>
  );
}
