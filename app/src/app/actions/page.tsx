import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, getActions, type Action } from "@/lib/api";

const PRIORITY_STYLES: Record<string, React.CSSProperties> = {
  immediate: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  near_term: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  planned:   { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  watch:     { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
};

const PRIORITY_LABELS: Record<string, string> = {
  immediate: "Immediate",
  near_term: "Near Term",
  planned:   "Planned",
  watch:     "Watch",
};

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(0,196,180,0.12)",    color: "#00c4b4",  border: "1px solid rgba(0,196,180,0.3)" },
  in_progress: { background: "rgba(245,158,11,0.12)",   color: "#fcd34d",  border: "1px solid rgba(245,158,11,0.3)" },
  blocked:     { background: "rgba(239,68,68,0.12)",    color: "#fca5a5",  border: "1px solid rgba(239,68,68,0.3)" },
  closed:      { background: "rgba(148,163,184,0.08)",  color: "#64748b",  border: "1px solid #1e293b" },
  accepted:    { background: "rgba(148,163,184,0.08)",  color: "#64748b",  border: "1px solid #1e293b" },
};

const STATUS_LABELS: Record<string, string> = {
  open:        "Open",
  in_progress: "In Progress",
  blocked:     "Blocked",
  closed:      "Closed",
  accepted:    "Accepted",
};

const STAT_CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: "12px",
  padding: "16px 20px",
};

type Params = Record<string, string | undefined>;

function filterHref(current: Params, key: string, value: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v !== undefined && k !== key) params.set(k, v);
  }
  if (value !== null) params.set(key, value);
  const qs = params.toString();
  return `/actions${qs ? `?${qs}` : ""}`;
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
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

function isOverdue(action: Action): boolean {
  if (!action.due_date) return false;
  if (action.status === "closed" || action.status === "accepted") return false;
  return new Date(action.due_date) < new Date();
}

function ActionRow({ action }: { action: Action }) {
  const priorityStyle = PRIORITY_STYLES[action.priority] ?? PRIORITY_STYLES.watch!;
  const priorityLabel = PRIORITY_LABELS[action.priority] ?? action.priority;
  const statusStyle = STATUS_STYLES[action.status] ?? STATUS_STYLES.open!;
  const statusLabel = STATUS_LABELS[action.status] ?? action.status;
  const overdue = isOverdue(action);

  const dueDate = action.due_date
    ? new Date(action.due_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: "var(--color-brand-surface, #111827)",
        borderColor: "#1e293b",
        borderLeft: overdue ? "3px solid rgba(239,68,68,0.4)" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: title + source info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold mb-1" style={{ color: "#f1f5f9" }}>
            {action.title}
          </p>
          {action.description && (
            <p className="text-xs line-clamp-2 mb-2" style={{ color: "#475569" }}>
              {action.description}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
              style={priorityStyle}
            >
              {priorityLabel}
            </span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              style={statusStyle}
            >
              {statusLabel}
            </span>
            {action.action_type && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs"
                style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
              >
                {action.action_type}
              </span>
            )}
          </div>
        </div>

        {/* Right: due date */}
        <div className="flex-shrink-0 text-right">
          {dueDate ? (
            <p className="text-xs" style={{ color: overdue ? "#fca5a5" : "#64748b" }}>
              {overdue ? "Overdue · " : "Due "}
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

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const sp = await searchParams;
  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  const activeStatus   = sp.status   ?? "";
  const activePriority = sp.priority ?? "";
  const activeOverdue  = sp.overdue  === "true";

  const actionsData = await getActions(token, {
    status:   activeStatus   || undefined,
    priority: activePriority || undefined,
    overdue:  activeOverdue  || undefined,
    limit: 100,
  });

  const actions = actionsData?.actions ?? [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openCount      = actions.filter((a) => a.status === "open" || a.status === "in_progress").length;
  const overdueCount   = actions.filter((a) => isOverdue(a)).length;
  const highPrioCount  = actions.filter((a) => a.priority === "immediate" || a.priority === "near_term").length;

  const currentSp: Params = {
    ...(sp.status   ? { status:   sp.status }   : {}),
    ...(sp.priority ? { priority: sp.priority } : {}),
    ...(sp.overdue  ? { overdue:  sp.overdue }  : {}),
  };

  const isFiltered = !!(activeStatus || activePriority || activeOverdue);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            Remediation Actions
          </h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Open actions across all findings and assessments
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Open
          </p>
          <p className="text-3xl font-bold" style={{ color: "#f1f5f9" }}>{openCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Overdue
          </p>
          <p className="text-3xl font-bold" style={{ color: overdueCount > 0 ? "#fca5a5" : "#f1f5f9" }}>
            {overdueCount}
          </p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            High Priority
          </p>
          <p className="text-3xl font-bold" style={{ color: highPrioCount > 0 ? "#fcd34d" : "#f1f5f9" }}>
            {highPrioCount}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Status
          </span>
          <FilterPill label="All"         href={filterHref(currentSp, "status", null)}          active={!activeStatus && !activeOverdue} />
          <FilterPill label="Open"        href={filterHref(currentSp, "status", "open")}         active={activeStatus === "open"} />
          <FilterPill label="In Progress" href={filterHref(currentSp, "status", "in_progress")}  active={activeStatus === "in_progress"} />
          <FilterPill label="Blocked"     href={filterHref(currentSp, "status", "blocked")}      active={activeStatus === "blocked"} />
          <FilterPill label="Overdue"     href={filterHref({ ...currentSp, overdue: "true" }, "status", null)} active={activeOverdue} />
          <FilterPill label="Closed"      href={filterHref(currentSp, "status", "closed")}       active={activeStatus === "closed"} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Priority
          </span>
          <FilterPill label="All"       href={filterHref(currentSp, "priority", null)}            active={!activePriority} />
          <FilterPill label="Immediate" href={filterHref(currentSp, "priority", "immediate")}     active={activePriority === "immediate"} />
          <FilterPill label="Near Term" href={filterHref(currentSp, "priority", "near_term")}     active={activePriority === "near_term"} />
          <FilterPill label="Planned"   href={filterHref(currentSp, "priority", "planned")}       active={activePriority === "planned"} />
          <FilterPill label="Watch"     href={filterHref(currentSp, "priority", "watch")}         active={activePriority === "watch"} />
        </div>
      </div>

      {/* Action list */}
      {actions.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{
            background: "var(--color-brand-surface, #111827)",
            borderColor: isFiltered ? "#1e293b" : "rgba(34,197,94,0.2)",
          }}
        >
          {isFiltered ? (
            <p className="text-sm" style={{ color: "#94a3b8" }}>
              No actions match your current filters.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold mb-1" style={{ color: "#86efac" }}>
                All clear — no open actions.
              </p>
              <p className="text-xs" style={{ color: "#64748b" }}>
                Actions are created when findings require remediation.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {actions.map((a) => (
            <ActionRow key={a.id} action={a} />
          ))}
        </div>
      )}
    </div>
  );
}
