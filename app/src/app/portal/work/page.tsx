"use client";

/**
 * /portal/work — delegation (VA-D1).
 *
 * One page, two audiences, because they are looking at the same list from
 * different ends:
 *
 *   a contributor wants "what am I supposed to do" — Assigned to me;
 *   the coordinator wants "where is this questionnaire stuck" — who owns what,
 *   what nobody owns, and who is behind.
 *
 * Nothing here is a second copy of the questionnaire. Assignment is work
 * management ON the one shared questionnaire VA-P1 created, and every question
 * links straight into it.
 *
 * Two honesty rules the engine enforces and this page must not undo:
 *   - a single-framework assessment has NO sections, and says so rather than
 *     offering one group that silently means "everything";
 *   - "complete" and "reopened by the reviewer" are different facts. An
 *     answered question the reviewer came back on is shown as answered AND
 *     needing work, never as one or the other.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  errorMessage,
  portalFetch,
  type PortalAssignments,
  type PortalParticipants,
  type PortalProgress,
} from "../portalApi";

function pct(complete: number, total: number): string {
  // No denominator, no percentage. A "0%" derived from nothing reads as real.
  if (total === 0) return "—";
  return `${Math.round((complete / total) * 100)}%`;
}

export default function PortalWorkPage(): JSX.Element {
  const [assignments, setAssignments] = useState<PortalAssignments | null>(null);
  const [progress, setProgress] = useState<PortalProgress | null>(null);
  const [team, setTeam] = useState<PortalParticipants | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkFramework, setBulkFramework] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [a, p, t] = await Promise.all([
      portalFetch<PortalAssignments>("/assignments"),
      portalFetch<PortalProgress>("/progress"),
      portalFetch<PortalParticipants>("/participants"),
    ]);
    if (a.status === 401) {
      setError("Your session has ended. Open your invitation link again.");
      setAssignments(null);
    } else if (!a.ok || !a.body) {
      setError(errorMessage(a, "The work list could not be loaded."));
    } else {
      setAssignments(a.body);
      setProgress(p.ok ? p.body : null);
      setTeam(t.ok ? t.body : null);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setOwner(requirementId: string, participantId: string): Promise<void> {
    setBusy(true);
    const res = await portalFetch(`/assignments/${encodeURIComponent(requirementId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: participantId || null }),
    });
    if (!res.ok) setError(errorMessage(res, "That could not be assigned."));
    else await load();
    setBusy(false);
  }

  async function bulkAssign(): Promise<void> {
    if (!bulkFramework) return;
    setBusy(true);
    const res = await portalFetch("/assignments/framework", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        framework_id: bulkFramework,
        participant_id: bulkAssignee || null,
      }),
    });
    if (!res.ok) setError(errorMessage(res, "That group could not be assigned."));
    else {
      setBulkFramework("");
      await load();
    }
    setBusy(false);
  }

  const canManage = assignments?.you.can_manage_work === true;
  const assignable = (team?.participants ?? []).filter((p) => p.status !== "revoked");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Work</h1>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Everyone works on the same questionnaire. Assignments say who is expected to answer
          what — they do not create separate copies, and they do not change who actually
          answered anything.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {/* ── Assigned to me ─────────────────────────────────────────────── */}
      {assignments && (
        <section className="rounded-xl border border-brand-line bg-brand-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Assigned to me
          </h2>
          {assignments.mine.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              Nothing is assigned to you yet. You can still answer any question in the{" "}
              <Link href="/portal/questionnaire" className="text-brand-teal hover:underline">
                questionnaire
              </Link>
              .
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-300">
                {assignments.mine.length} assigned · {assignments.mine_outstanding} still to do
              </p>
              <ul className="mt-3 divide-y divide-brand-line">
                {assignments.mine.map((i) => (
                  <li key={i.requirement_id} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <span className="mr-2 font-mono text-xs text-slate-500">{i.reference}</span>
                      <span className="text-sm text-slate-200">{i.title}</span>
                      <span className="ml-2 text-xs text-slate-500">{i.framework_name}</span>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {i.clarification_open && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                          Reviewer replied
                        </span>
                      )}
                      <span
                        className={
                          i.complete
                            ? "rounded-full bg-brand-teal/15 px-2 py-0.5 text-xs text-brand-teal"
                            : "rounded-full bg-slate-700/40 px-2 py-0.5 text-xs text-slate-300"
                        }
                      >
                        {i.complete ? "Answered" : "To do"}
                      </span>
                      <Link
                        href="/portal/questionnaire"
                        className="text-xs font-medium text-brand-teal hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ── Coordinator board ──────────────────────────────────────────── */}
      {canManage && progress && (
        <section className="rounded-xl border border-brand-line bg-brand-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Progress
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            {progress.complete} of {progress.total} answered ({pct(progress.complete, progress.total)})
            {progress.unassigned > 0 && (
              <span className="ml-2 text-amber-300">· {progress.unassigned} unassigned</span>
            )}
          </p>

          <ul className="mt-3 divide-y divide-brand-line">
            {progress.by_participant.map((p) => (
              <li key={p.participant_id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-200">
                  {p.full_name}
                  {p.status === "revoked" && (
                    <span className="ml-2 text-xs text-red-300">access removed</span>
                  )}
                </span>
                <span className="text-slate-400">
                  {/* Measured against their OWN assigned work, never the whole
                      questionnaire — otherwise everyone looks permanently behind. */}
                  {p.complete} / {p.assigned} {p.assigned > 0 && `(${pct(p.complete, p.assigned)})`}
                </span>
              </li>
            ))}
          </ul>

          {progress.by_framework ? (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                By framework
              </h3>
              <ul className="mt-2 divide-y divide-brand-line">
                {progress.by_framework.map((f) => (
                  <li key={f.framework_id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-200">{f.framework_name}</span>
                    <span className="text-slate-400">
                      {f.complete} / {f.total} ({pct(f.complete, f.total)})
                      {f.unassigned > 0 && (
                        <span className="ml-2 text-amber-300">{f.unassigned} unassigned</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-slate-600/40 bg-slate-700/20 p-3 text-xs text-slate-400">
              Section grouping is unavailable for this assessment — it covers a single framework.
              Assign individual questions below.
            </p>
          )}
        </section>
      )}

      {/* ── Bulk assign a framework ────────────────────────────────────── */}
      {canManage && assignments?.assignable_frameworks && (
        <section className="rounded-xl border border-brand-line bg-brand-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Assign a whole framework
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Assigns every question of that framework that is part of this assessment.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={bulkFramework}
              onChange={(e) => setBulkFramework(e.target.value)}
              disabled={busy}
              className="rounded-lg border border-brand-line bg-brand-bg px-3 py-2 text-sm text-slate-200"
            >
              <option value="">Choose a framework…</option>
              {assignments.assignable_frameworks.map((f) => (
                <option key={f.framework_id} value={f.framework_id}>
                  {f.framework_name} ({f.question_count} questions)
                </option>
              ))}
            </select>
            <select
              value={bulkAssignee}
              onChange={(e) => setBulkAssignee(e.target.value)}
              disabled={busy}
              className="rounded-lg border border-brand-line bg-brand-bg px-3 py-2 text-sm text-slate-200"
            >
              <option value="">Unassign</option>
              {assignable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void bulkAssign()}
              disabled={busy || !bulkFramework}
              className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90 disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        </section>
      )}

      {/* ── Per-question assignment ────────────────────────────────────── */}
      {canManage && assignments && (
        <section className="rounded-xl border border-brand-line bg-brand-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Every question
          </h2>
          <ul className="mt-3 divide-y divide-brand-line">
            {assignments.items.map((i) => (
              <li key={i.requirement_id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <span className="mr-2 font-mono text-xs text-slate-500">{i.reference}</span>
                  <span className="text-sm text-slate-200">{i.title}</span>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {i.framework_name}
                    {i.complete ? " · answered" : " · not answered"}
                    {i.clarification_open ? " · reviewer replied" : ""}
                  </div>
                </div>
                <select
                  value={i.assigned_to_participant_id ?? ""}
                  onChange={(e) => void setOwner(i.requirement_id, e.target.value)}
                  disabled={busy}
                  className="flex-shrink-0 rounded-lg border border-brand-line bg-brand-bg px-2 py-1 text-xs text-slate-200"
                >
                  <option value="">Unassigned</option>
                  {assignable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
