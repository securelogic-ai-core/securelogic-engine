/**
 * MyActionsView.tsx — the workspace remediation queue (ERIP §5 My Actions depth).
 * Shown ONLY under SECURELOGIC_DECISION_WORKSPACE_ENABLED (page.tsx branches on it);
 * the flag-off legacy /actions list is untouched (byte-identical).
 *
 * Presentational server component. All logic lives in the pure, unit-tested
 * actionQueue.ts helpers. It turns a flat list into an enterprise remediation queue:
 * ownership scope toggle (mine / all open), SLA attention tiles, SLA-urgency
 * grouping, and — the fix for the standalone-Actions dead end — every row deep-links
 * into the source Finding's Decision Workspace.
 */

import Link from "next/link";
import type { Action, ActionsSummary } from "@/lib/api";
import type { ActionScope } from "./myActions";
import { showingOfTotal } from "./myActions";
import {
  slaState,
  actionSourceHref,
  ownershipLabel,
  actionAttention,
  groupBySla,
  isActiveStatus,
  type SlaState,
  type Ownership,
} from "./actionQueue";

const CARD: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: "12px",
  padding: "16px 20px",
};

const SLA_STYLE: Record<SlaState, React.CSSProperties> = {
  overdue: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  due_today: { background: "rgba(245,158,11,0.18)", color: "#fcd34d" },
  due_this_week: { background: "rgba(245,158,11,0.12)", color: "#fcd34d" },
  scheduled: { background: "rgba(59,130,246,0.12)", color: "#93c5fd" },
  none: { background: "rgba(148,163,184,0.1)", color: "#94a3b8" },
};
const SLA_TEXT: Record<SlaState, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  due_this_week: "Due this week",
  scheduled: "Scheduled",
  none: "No SLA",
};

const OWNER_STYLE: Record<Ownership, React.CSSProperties> = {
  you: { background: "rgba(0,196,180,0.15)", color: "#00c4b4" },
  assigned: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  unassigned: { background: "rgba(239,68,68,0.12)", color: "#fca5a5" },
};
const OWNER_TEXT: Record<Ownership, string> = { you: "You", assigned: "Assigned", unassigned: "Unassigned" };

const SOURCE_NOUN: Record<string, string> = {
  finding: "finding",
  risk: "risk",
  obligation: "obligation",
  signal: "intelligence signal",
  assessment: "assessment",
  manual: "manual entry",
};

function Chip({ style, children }: { style: React.CSSProperties; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {children}
    </span>
  );
}

function ScopeTab({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }
          : { background: "transparent", color: "#94a3b8", border: "1px solid #1e293b" }
      }
    >
      {label}
    </Link>
  );
}

function Tile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={CARD}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
        {label}
      </p>
      <p className="text-3xl font-bold" style={{ color: warn && value > 0 ? "#fca5a5" : "#f1f5f9" }}>
        {value}
      </p>
    </div>
  );
}

function ActionRow({
  action,
  sessionUserId,
  nowMs,
}: {
  action: Action;
  sessionUserId: string | undefined;
  nowMs: number;
}) {
  const sla = slaState(action, nowMs);
  const owner = ownershipLabel(action, sessionUserId);
  const href = actionSourceHref(action);
  const sourceNoun = SOURCE_NOUN[action.source_type] ?? action.source_type.replace(/_/g, " ");
  const dueDate = action.due_date
    ? new Date(action.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const titleEl = href ? (
    <Link href={href} className="text-sm font-semibold hover:underline" style={{ color: "#f1f5f9" }}>
      {action.title}
    </Link>
  ) : (
    <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
      {action.title}
    </p>
  );

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: "var(--color-brand-surface, #111827)",
        borderColor: "#1e293b",
        borderLeft: sla === "overdue" ? "3px solid rgba(239,68,68,0.4)" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1">{titleEl}</div>
          <p className="text-xs mb-2" style={{ color: "#475569" }}>
            {href ? (
              <>
                Remediating this {sourceNoun} —{" "}
                <Link href={href} className="hover:underline" style={{ color: "#00c4b4" }}>
                  open in Decision Workspace →
                </Link>
              </>
            ) : (
              <>From {sourceNoun}</>
            )}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip style={SLA_STYLE[sla]}>{SLA_TEXT[sla]}</Chip>
            <Chip style={OWNER_STYLE[owner]}>{OWNER_TEXT[owner]}</Chip>
            {action.action_type && (
              <Chip style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}>{action.action_type}</Chip>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          {dueDate ? (
            <p className="text-xs" style={{ color: sla === "overdue" ? "#fca5a5" : "#64748b" }}>
              {sla === "overdue" ? "Overdue · " : "Due "}
              {dueDate}
            </p>
          ) : (
            <p className="text-xs" style={{ color: "#334155" }}>
              No due date
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyActionsView({
  actions,
  scope,
  sessionUserId,
  nowMs,
  summary = null,
  total,
  statusFilter,
}: {
  actions: Action[];
  scope: ActionScope;
  sessionUserId: string | undefined;
  nowMs: number;
  // Authoritative org-wide counts (team scope only). When present, the Open and
  // Overdue tiles read these server COUNT(*)s so they reconcile with the
  // dashboard Actions ring instead of scanning the ≤100 fetched slice.
  summary?: ActionsSummary | null;
  // True org-wide total for the current scope, for the "Showing N of M" note.
  total?: number;
  // Active ?status filter (team scope): the list below is narrowed to this
  // status while the tiles stay org-wide. Disclosed so the two never look
  // contradictory (Metric Contract).
  statusFilter?: string;
}) {
  const att = actionAttention(actions, nowMs);
  const noSla = actions.filter((a) => isActiveStatus(a.status) && slaState(a, nowMs) === "none").length;
  const groups = groupBySla(actions, nowMs);

  // Authoritative server counts — never derived by scanning the fetched page, which is
  // capped and would under-report.
  //
  // The tiles must be scoped to the SAME population as the list beneath them. In "mine"
  // that is the caller's own remediation (my_open_count / my_overdue_count); in "team" it
  // is the org (open_count / overdue_count). Showing the org's numbers above a personal
  // list is the enterprise-metric-in-a-user-scoped-view defect — the person reads someone
  // else's backlog as their own.
  //
  // my_* are optional (older engine builds): fall back to the slice-derived counts rather
  // than silently substituting the ORG total, which would be a wrong number, not a stale one.
  const openTile =
    scope === "mine"
      ? (summary?.my_open_count ?? att.open)
      : (summary?.open_count ?? att.open);
  const overdueTile =
    scope === "mine"
      ? (summary?.my_overdue_count ?? att.overdue)
      : (summary?.overdue_count ?? att.overdue);
  const truncationNote = showingOfTotal(actions.length, total);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header + ownership scope toggle */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            {scope === "mine" ? "My Actions" : "Remediation"}
          </h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            {scope === "mine"
              ? "Remediation assigned to you — grouped by SLA urgency"
              : "All open remediation across findings — owners and SLA"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScopeTab label="Assigned to me" href="/actions?view=mine" active={scope === "mine"} />
          <ScopeTab label="All open" href="/actions?view=team" active={scope === "team"} />
        </div>
      </div>

      {/* Honest pagination disclosure — EITHER scope can exceed the 100-row page, and the
          personal one used to disclose nothing at all. */}
      {truncationNote && (
        <p className="mb-4 text-xs" style={{ color: "#64748b" }}>
          {truncationNote} remediation actions
          {scope === "mine" ? " assigned to you" : " open across the org"} — tiles reflect
          the full {scope === "mine" ? "assigned" : "org"} total.
        </p>
      )}

      {/* Active status filter disclosure — the list is narrowed, the tiles are
          org-wide; say so instead of letting them look contradictory. */}
      {statusFilter && (
        <p className="mb-4 text-xs" style={{ color: "#94a3b8" }}>
          Filtered to status: <strong>{statusFilter.replace("_", " ")}</strong>
          {" · "}
          <Link href="/actions?view=team" style={{ color: "#93c5fd" }}>
            Clear filter
          </Link>
        </p>
      )}

      {/* Attention tiles */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Tile label="Open" value={openTile} />
        <Tile label="Overdue" value={overdueTile} warn />
        <Tile label="At risk this week" value={att.atRisk} warn />
        {scope === "team" ? (
          <Tile label="Unassigned" value={att.unassigned} warn />
        ) : (
          <Tile label="No SLA set" value={noSla} />
        )}
      </div>

      {/* SLA-grouped remediation queue */}
      {groups.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(34,197,94,0.2)" }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: "#86efac" }}>
            All clear — no remediation {scope === "mine" ? "assigned to you" : "open"}.
          </p>
          <p className="text-xs" style={{ color: "#64748b" }}>
            Actions are created when a finding requires remediation.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.bucket}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
                  {g.label}
                </h2>
                <span className="text-xs" style={{ color: "#475569" }}>
                  {g.actions.length}
                </span>
              </div>
              <div className="space-y-3">
                {g.actions.map((a) => (
                  <ActionRow key={a.id} action={a} sessionUserId={sessionUserId} nowMs={nowMs} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
