"use client";

/**
 * BulkBucketList — bucket member list with selection + bulk actions (W2).
 *
 * Selection is page-scoped (the visible keyset page); actions go through
 * POST /api/findings/bulk, where every decision is INDIVIDUALLY guarded by
 * the lifecycle machine — bulk is a convenience, never a bypass. Refusals
 * are summarized honestly (never a silent partial apply).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Finding } from "@/lib/api";
import { FindingCard } from "@/components/FindingCard";
import { bulkAssignToMeAction, bulkDecideAction, type BulkResult } from "./bulkActions";

const REFUSAL_COPY: Record<string, string> = {
  close_requires_remediated_or_accepted_risk: "remediation not complete",
  actor_identity_required: "requires a signed-in user",
  separation_of_duties: "closer must differ from remediator",
  invalid_decision_transition: "not allowed from current state",
  not_found: "not found",
};

const BULK_DECISIONS = [
  { value: "mitigating", label: "Mitigating (accept plan)" },
  { value: "accepted_risk", label: "Accept risk" },
  { value: "resolved", label: "Resolve (close)" },
] as const;

export default function BulkBucketList({
  findings,
  revalidateUrl,
}: {
  findings: Finding[];
  revalidateUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decision, setDecision] = useState<string>("mitigating");
  const [note, setNote] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = findings.length > 0 && findings.every((f) => selected.has(f.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(findings.map((f) => f.id)));

  const run = (fn: (ids: string[]) => Promise<BulkResult>) =>
    start(async () => {
      const ids = [...selected];
      const r = await fn(ids);
      if (r.error) {
        setNote(r.error);
        return;
      }
      const refusedNote =
        (r.refused ?? 0) > 0
          ? ` · ${r.refused} refused (${REFUSAL_COPY[r.refusalReason ?? ""] ?? r.refusalReason ?? "guarded"})`
          : "";
      setNote(`${r.updated ?? 0} applied${refusedNote}`);
      setSelected(new Set());
      router.refresh();
    });

  return (
    <>
      {/* Selection toolbar */}
      <div className="mb-3 flex items-center gap-3 flex-wrap" style={{ minHeight: 34 }}>
        <label className="flex items-center gap-2 text-xs" style={{ color: "#94a3b8" }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={pending} />
          Select page
        </label>
        {selected.size > 0 && (
          <>
            <span className="text-xs font-semibold" style={{ color: "#f1f5f9" }}>
              {selected.size} selected
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(bulkAssignToMeAction)}
              className="px-3 py-1 rounded-lg text-xs font-medium"
              style={{ border: "1px solid #1e293b", color: "#00c4b4", background: "transparent", cursor: "pointer" }}
            >
              Assign to me
            </button>
            <span className="flex items-center gap-1">
              <select
                value={decision}
                disabled={pending}
                onChange={(e) => setDecision(e.target.value)}
                className="text-xs rounded-lg px-2 py-1"
                style={{ background: "#0f172a", color: "#f1f5f9", border: "1px solid #334155" }}
              >
                {BULK_DECISIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={() => run((ids) => bulkDecideAction(ids, decision))}
                className="px-3 py-1 rounded-lg text-xs font-medium"
                style={{ border: "1px solid #1e293b", color: "#94a3b8", background: "transparent", cursor: "pointer" }}
              >
                Apply decision
              </button>
            </span>
          </>
        )}
        {note && (
          <span className="text-xs" style={{ color: "#94a3b8" }}>{note}</span>
        )}
      </div>

      {/* Rows: checkbox + the standard card */}
      <div className="space-y-3 mb-6">
        {findings.map((f) => (
          <div key={f.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selected.has(f.id)}
              onChange={() => toggle(f.id)}
              disabled={pending}
              style={{ marginTop: 22 }}
              aria-label={`Select ${f.title}`}
            />
            <div className="flex-1 min-w-0">
              <FindingCard finding={f} revalidateUrl={revalidateUrl} workspace />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
