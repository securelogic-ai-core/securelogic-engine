import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getActions,
  getActionsSummary,
  type Action,
  type ActionsSummaryParams,
} from "@/lib/api";
import { UnknownValue, UnknownValueNote } from "@/components/edx/UnknownValue";
import { UnavailableNotice } from "@/components/edx/UnavailableNotice";
import { isUnavailable } from "@/lib/edx/loadState";
import { myActionsRedirect, actionScope, showingOfTotal } from "./myActions";
import MyActionsView from "./MyActionsView";

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

/**
 * The two priorities the "High Priority" tile counts. Split into the high and
 * the not-high sets rather than one list, because a priority-filtered view can
 * answer the tile WITHOUT another count: a population filtered to `planned`
 * contains exactly zero high-priority actions, and a population filtered to
 * `immediate` is entirely high-priority, so its own total is the answer.
 */
const HIGH_PRIORITIES = new Set(["immediate", "near_term"]);
const NON_HIGH_PRIORITIES = new Set(["planned", "watch"]);

/**
 * An exact count, or `null` when the number is not known.
 *
 * `null` is the whole point: every tile on this page used to derive its number
 * from the returned page, so a failed or missing count became a confident 0.
 * A count we do not have must stay unrepresentable as a number — see
 * <UnknownValue>.
 */
type ExactCount = number | null;

function exact(value: number | undefined): ExactCount {
  return typeof value === "number" ? value : null;
}

/** The sum of two exact counts — unknown if EITHER part is unknown. */
function exactSum(a: number | undefined, b: number | undefined): ExactCount {
  return typeof a === "number" && typeof b === "number" ? a + b : null;
}

/**
 * A stat tile whose value is a server count. Renders the number, or the shared
 * unknown-value marker when the count could not be loaded — never a 0 standing
 * in for "we don't know", and never a figure scanned out of the capped page.
 */
function StatTile({
  label,
  value,
  warnColor,
}: {
  label: string;
  value: ExactCount;
  /** Colour applied only when the count is known AND non-zero. */
  warnColor?: string;
}) {
  return (
    <div style={STAT_CARD_STYLE}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
        {label}
      </p>
      <p
        className="text-3xl font-bold"
        style={{ color: warnColor && value !== null && value > 0 ? warnColor : "#f1f5f9" }}
      >
        {value === null ? <UnknownValue label={label} /> : value}
      </p>
    </div>
  );
}

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

function ActionRow({ action }: { action: Action }) {
  const priorityStyle = PRIORITY_STYLES[action.priority] ?? PRIORITY_STYLES.watch!;
  const priorityLabel = PRIORITY_LABELS[action.priority] ?? action.priority;
  const statusStyle = STATUS_STYLES[action.status] ?? STATUS_STYLES.open!;
  const statusLabel = STATUS_LABELS[action.status] ?? action.status;
  // Straight from the server (Metric Contract). The local re-derivation this
  // replaces used NOW() instead of CURRENT_DATE, so a due-today action was
  // overdue here and on-time on the dashboard — the same action, two answers.
  const overdue = action.is_overdue;

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

  // ERIP Package 3 (Decision Workspace) — DARK. When on, /actions is the "My
  // Actions" view (the caller's own actions across findings); a bare /actions
  // redirects to the canonical ?view=mine form so the route reads as a redirect,
  // not a standalone org-wide list. Flag-off = the unchanged legacy list
  // (byte-identical). This is the minimal bridge, NOT the P3.4 saved-views system.
  const workspace = process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED === "true";
  const dest = myActionsRedirect(workspace, sp.view);
  if (dest) redirect(dest);

  // Workspace remediation queue (§5 depth): SLA framing, ownership, source linkage.
  // Scope "mine" filters to the SESSION user (R5 — never request input); "team"
  // shows all open remediation. Flag-off falls through to the unchanged legacy list.
  const scope = workspace ? actionScope(sp.view) : null;
  if (scope) {
    // R5 fail-closed: "assigned to me" is unanswerable without a user identity (an
    // API-key caller has none). Answer it with an empty queue rather than asking the
    // engine for something it would have to reject — and NEVER widen to the org's
    // actions, which is the failure this guard exists to prevent.
    if (scope === "mine" && !session.userId) {
      return (
        <MyActionsView
          actions={[]}
          scope="mine"
          sessionUserId={undefined}
          nowMs={Date.now()}
          summary={null}
          total={undefined}
        />
      );
    }

    // "team" (All open) is where the org-wide dashboard Actions counts now land
    // (orgActionsHref → ?view=team). Its attention tiles must be authoritative
    // org-wide COUNTs — not a scan of the ≤100 fetched slice — so they reconcile
    // with the dashboard ring. `total` drives the honest "Showing N of M"
    // disclosure.
    //
    // Metric Contract: honour ?status=… and ?overdue=true in the team view — a
    // dashboard tile that says "Open" (or "Overdue") must land on a list
    // filtered the same way (previously both params were silently dropped and
    // every tile landed on the same unfiltered list).
    const statusFilter = scope === "team" && sp.status ? sp.status : undefined;
    const overdueFilter = scope === "team" && sp.overdue === "true" ? true : undefined;
    // ?active=true is what the dashboard's ACTIVE tiles link to. Honouring it here
    // is what finally lets the destination reproduce the tile's number instead of
    // listing closed and accepted actions under a heading that promised N active.
    const activeFilter = scope === "team" && sp.active === "true" ? true : undefined;

    // "mine" is now filtered by the ENGINE (?owner=me), not by slicing a fetched page.
    //
    // It used to ask for the org's actions and filter them here. The engine caps a page at
    // 100, so in any org with more than 100 actions a user's own assigned work could sit
    // outside the fetched page and simply never appear — and `total` was withheld for this
    // scope, so nothing even disclosed the truncation. A queue that silently drops your
    // work is worse than one that says it is empty.
    //
    // The Findings "My Work" bucket has always done this correctly, server-side. This makes
    // the two agree, and it is the codebase's own stated rule (workQueues.ts): never
    // client-side filtering of a page, so queues stay correct at scale.
    const [data, summary] = await Promise.all([
      getActions(token, {
        limit: 200,
        status: statusFilter,
        overdue: overdueFilter,
        active: activeFilter,
        owner: scope === "mine" ? "me" : undefined,
      }),
      getActionsSummary(token),
    ]);
    const scoped = data?.actions ?? [];
    return (
      <MyActionsView
        actions={scoped}
        scope={scope}
        sessionUserId={session.userId}
        nowMs={Date.now()}
        summary={summary}
        // `total` now shown in BOTH scopes: the engine's count of the whole matched set, so
        // "Showing N of M" is honest for a personal queue too.
        total={data?.total}
        statusFilter={overdueFilter ? `${statusFilter ? `${statusFilter} · ` : ""}overdue` : statusFilter}
      />
    );
  }

  const activeStatus   = sp.status   ?? "";
  const activePriority = sp.priority ?? "";
  const activeOverdue  = sp.overdue  === "true";
  const activeOnly     = sp.active   === "true";

  // ONE filter set, handed to the list and to every count on this page. The
  // engine builds the WHERE for GET /api/actions and GET /api/actions/summary
  // from a single shared buildActionFilters(), so passing the identical object
  // makes "the tiles describe the list" a property of the system rather than a
  // claim this page makes about itself.
  const actionFilters: ActionsSummaryParams = {
    status:   activeStatus   || undefined,
    priority: activePriority || undefined,
    overdue:  activeOverdue  || undefined,
    // Honoured with the workspace flag OFF too, so the dashboard tile reconciles
    // with its destination in BOTH flag states rather than only the new one.
    active:   activeOnly     || undefined,
  };

  // "High priority" is immediate|near_term at ANY status, and the summary has no
  // field for that population (`immediate_count` covers one of the two and
  // additionally AND-s ACTIVE). The list route's `total` IS an exact,
  // filter-scoped count, so each part is counted with a deliberately tiny
  // request rather than by scanning rows. Skipped entirely when the view is
  // already priority-filtered — see HIGH_PRIORITIES.
  const needsPriorityTotals = activePriority === "";

  const [actionsData, summary, immediateData, nearTermData] = await Promise.all([
    getActions(token, { ...actionFilters, limit: 100 }),
    getActionsSummary(token, actionFilters),
    needsPriorityTotals
      ? getActions(token, { ...actionFilters, priority: "immediate", limit: 1 })
      : null,
    needsPriorityTotals
      ? getActions(token, { ...actionFilters, priority: "near_term", limit: 1 })
      : null,
  ]);

  // Legacy list (workspace flag off): the org-wide remediation list, unchanged.
  const actions = actionsData?.actions ?? [];
  // Honest pagination: the list is capped (≤100). Disclose "Showing N of M"
  // whenever the true filtered total exceeds the rendered slice.
  const truncationNote = showingOfTotal(actions.length, actionsData?.total);

  // EXACT server counts for the current filter set.
  //
  // These three numbers were each `actions.filter(…).length` — a scan of the
  // page the engine had just capped at 100. Below the cap that arithmetic is
  // right, which is precisely why it survived: the tiles only start lying once
  // an org has more than a page of matching work, and then they lie silently
  // and permanently, with the "Showing N of M" line beneath them disclosing the
  // truncation of the LIST while the tiles above kept presenting a slice as a
  // total. No page length is read for any count below.
  //
  // Open = status open|in_progress, exactly as before: `open_only_count +
  // in_progress_count` are the summary's own exact parts. (Deliberately NOT
  // `open_count`, which is ACTIVE and includes `blocked` — un-capping a number
  // must not quietly redefine it.)
  const openCount = exactSum(summary?.open_only_count, summary?.in_progress_count);
  // Overdue = `overdue_count`, computed from sqlActionOverdue() — literally the
  // same SQL expression that produces each row's `is_overdue` field.
  const overdueCount = exact(summary?.overdue_count);
  const highPrioCount: ExactCount = needsPriorityTotals
    ? exactSum(immediateData?.total, nearTermData?.total)
    : HIGH_PRIORITIES.has(activePriority)
      ? // The filtered population is entirely high-priority: its own total is the count.
        exact(actionsData?.total)
      : NON_HIGH_PRIORITIES.has(activePriority)
        ? // A `planned`/`watch` population contains zero high-priority actions.
          // A provable zero, not an assumed one.
          0
        : // An unrecognised priority: the engine rejects the filter, so there is
          // no population to describe and nothing may be asserted about it.
          null;

  const countsUnavailable =
    openCount === null || overdueCount === null || highPrioCount === null;

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

      {/* Stat cards — exact server counts over the SAME filters as the list. */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatTile label="Open" value={openCount} />
        <StatTile label="Overdue" value={overdueCount} warnColor="#fca5a5" />
        <StatTile label="High Priority" value={highPrioCount} warnColor="#fcd34d" />
      </div>

      {/* A count that failed to load is disclosed, never rendered as a zero. */}
      {countsUnavailable && <UnknownValueNote />}

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

      {/* Honest pagination disclosure — no silent truncation at 100. */}
      {truncationNote && (
        <p className="mb-3 text-xs" style={{ color: "#64748b" }}>
          {truncationNote} — refine the filters above to narrow the list.
        </p>
      )}

      {/* Action list.

          EDX-1: a failed read is not "all clear". `actionsData?.actions ?? []`
          made an outage render the most reassuring sentence on the page —
          "All clear — no open actions." — to a customer whose remediation
          queue could not be reached. Of every empty state in the app this is
          the one most likely to end a check on outstanding work. */}
      {isUnavailable(actionsData) ? (
        <UnavailableNotice
          subject="Your remediation actions"
          denial="not an all-clear, and not an empty queue"
          reassurance="Your actions are unchanged."
          retryHref={filterHref(currentSp, "__none__", null)}
        />
      ) : actions.length === 0 ? (
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
