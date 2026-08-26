"use client";

/**
 * GovernanceLinkManager — declare/retract the four typed governance edges on
 * an AI system (T2-B). Same client-mutation idiom as VendorDependencyManager,
 * its sibling on this page: controlled select + click-to-submit, server action
 * behind it, engine authoritative. The engine POST is idempotent on
 * (org, ai_system, target) so a duplicate add is a no-op, and every link is a
 * human declaration — there is no edit, only add and remove (two audit rows).
 */

import { useState, useTransition } from "react";
import type { AiGovernanceLinkKind } from "@/lib/api";
import { addGovernanceLink, removeGovernanceLink } from "./governanceActions";

const INPUT_STYLE: React.CSSProperties = {
  background: "#0b1220",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12,
  maxWidth: "100%",
};

export function AddGovernanceLinkForm({
  aiSystemId,
  kind,
  kindLabel,
  options,
}: {
  aiSystemId: string;
  kind: AiGovernanceLinkKind;
  /** Human noun for the affordance, e.g. "framework". */
  kindLabel: string;
  options: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");

  if (options.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-medium"
        style={{ color: "#00c4b4", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      >
        + Link {kindLabel}
      </button>
    );
  }

  function submit() {
    if (!targetId || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await addGovernanceLink(aiSystemId, kind, targetId);
      if ("error" in result) setError(result.error);
      else {
        setOpen(false);
        setTargetId("");
      }
    });
  }

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        style={INPUT_STYLE}
        aria-label={`Link ${kindLabel}`}
      >
        <option value="" disabled>
          {kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1)}…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !targetId}
        className="text-xs font-medium px-3 py-1.5 rounded-md"
        style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "none", cursor: "pointer" }}
      >
        {pending ? "Linking…" : "Link"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-xs"
        style={{ color: "#64748b", background: "transparent", border: "none", cursor: "pointer" }}
      >
        Cancel
      </button>
      {error && (
        <p className="w-full text-xs mt-1" style={{ color: "#fca5a5" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RemoveGovernanceLinkButton({
  aiSystemId,
  kind,
  linkId,
  targetName,
}: {
  aiSystemId: string;
  kind: AiGovernanceLinkKind;
  linkId: string;
  targetName: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={`Remove ${kind} link to ${targetName}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await removeGovernanceLink(aiSystemId, kind, linkId);
        })
      }
      className="text-xs opacity-50 hover:opacity-100"
      style={{ color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer", padding: "0 2px" }}
    >
      ✕
    </button>
  );
}
