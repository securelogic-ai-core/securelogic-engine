/**
 * queueControls.ts — pure URL-state logic for the scalable Risk Findings queue
 * toolbar (search / filter / sort / pagination). React-free so it is unit
 * testable without a DOM harness, mirroring decisionQueue.ts.
 *
 * All queue state lives in the URL (so browser Back restores the exact search,
 * filters, sort and page after opening a finding). Every queue link also carries
 * `queue=all`, which forces the findings page's browse view even when the
 * Operations Center flag (SECURELOGIC_RISK_WORKSPACE_ENABLED) is on — the toolbar
 * enhances the browse queue, never the Operations Center home.
 */

import type { FindingsParams, FindingsSort, FindingsDueStatus } from "@/lib/api";

export const QUEUE_PAGE_SIZE = 25;

export const SEVERITY_OPTIONS = ["Critical", "High", "Moderate", "Low"] as const;
export const DOMAIN_OPTIONS = [
  "Access Management",
  "Vendor Risk",
  "AI Governance",
  "Regulatory",
  "Vulnerability",
  "Resilience",
  "General",
] as const;
export const GOVERNANCE_OPTIONS = ["needs_review", "mitigating", "accepted_risk", "resolved"] as const;
export const OPERATIONAL_OPTIONS = ["open", "in_progress", "remediated", "closed"] as const;
export const DUE_OPTIONS: readonly FindingsDueStatus[] = ["overdue", "today", "soon", "none"] as const;
export const SORT_OPTIONS: readonly FindingsSort[] = [
  "urgency",
  "severity",
  "due_date",
  "newest",
  "oldest",
] as const;

export const SORT_LABELS: Record<FindingsSort, string> = {
  urgency: "Most urgent",
  severity: "Severity",
  due_date: "Due date",
  newest: "Newest",
  oldest: "Oldest",
  created: "Newest", // legacy keyset — not offered in the toolbar
};

export const DUE_LABELS: Record<FindingsDueStatus, string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Due soon",
  none: "No due date",
};

export const GOVERNANCE_LABELS: Record<string, string> = {
  needs_review: "Needs review",
  mitigating: "Mitigating",
  accepted_risk: "Accepted risk",
  resolved: "Resolved",
};

export const OPERATIONAL_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  remediated: "Remediated",
  closed: "Closed",
};

export interface QueueState {
  q: string;
  severity: string;
  domain: string;
  governance: string; // decision_state
  operational: string; // operational_status
  due: string;
  assignedToMe: boolean;
  hasAction: boolean;
  hasEvidence: boolean;
  createdFrom: string;
  createdTo: string;
  sort: FindingsSort;
  page: number; // 1-based
}

export const EMPTY_QUEUE_STATE: QueueState = {
  q: "",
  severity: "",
  domain: "",
  governance: "",
  operational: "",
  due: "",
  assignedToMe: false,
  hasAction: false,
  hasEvidence: false,
  createdFrom: "",
  createdTo: "",
  sort: "urgency",
  page: 1,
};

type SP = Record<string, string | undefined>;

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): string {
  return value && (allowed as readonly string[]).includes(value) ? value : "";
}

function isIsoDate(v: string | undefined): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Parse the findings-page search params into a validated queue state. */
export function parseQueueState(sp: SP): QueueState {
  const sortRaw = sp.sort as FindingsSort | undefined;
  const sort: FindingsSort =
    sortRaw && (SORT_OPTIONS as readonly string[]).includes(sortRaw) ? sortRaw : "urgency";
  const pageNum = Number(sp.page);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
  return {
    q: typeof sp.q === "string" ? sp.q.slice(0, 200) : "",
    severity: pick(sp.severity, SEVERITY_OPTIONS),
    domain: pick(sp.domain, DOMAIN_OPTIONS),
    governance: pick(sp.governance, GOVERNANCE_OPTIONS),
    operational: pick(sp.operational, OPERATIONAL_OPTIONS),
    due: pick(sp.due, DUE_OPTIONS),
    assignedToMe: sp.mine === "1",
    hasAction: sp.has_action === "1",
    hasEvidence: sp.has_evidence === "1",
    createdFrom: isIsoDate(sp.created_from) ? (sp.created_from as string) : "",
    createdTo: isIsoDate(sp.created_to) ? (sp.created_to as string) : "",
    sort,
    page,
  };
}

/** Any narrowing filter/search active (sort/page alone do not count). */
export function hasActiveFilters(s: QueueState): boolean {
  return Boolean(
    s.q ||
      s.severity ||
      s.domain ||
      s.governance ||
      s.operational ||
      s.due ||
      s.assignedToMe ||
      s.hasAction ||
      s.hasEvidence ||
      s.createdFrom ||
      s.createdTo
  );
}

/** Queue state → the server fetch params (offset derived from the 1-based page). */
export function queueStateToParams(s: QueueState): FindingsParams {
  const params: FindingsParams = { sort: s.sort, limit: QUEUE_PAGE_SIZE };
  if (s.q) params.q = s.q;
  if (s.severity) params.severity = s.severity;
  if (s.domain) params.domain = s.domain;
  if (s.governance) params.decision_state = s.governance;
  if (s.operational) params.operational_status = s.operational;
  if (s.due) params.due = s.due as FindingsDueStatus;
  if (s.assignedToMe) params.owner = "me";
  if (s.hasAction) params.has_action = true;
  if (s.hasEvidence) params.has_evidence = true;
  if (s.createdFrom) params.created_from = s.createdFrom;
  if (s.createdTo) params.created_to = s.createdTo;
  if (s.page > 1) params.offset = (s.page - 1) * QUEUE_PAGE_SIZE;
  return params;
}

/**
 * Queue state → URL query string. On the browse queue it always carries
 * `queue=all` (forces the findings page's browse view even under the Operations
 * Center flag). When `extra.bucket` is present, the URL carries `bucket=<id>`
 * INSTEAD — the toolbar is refining a bucket view, and `queue=all` would silently
 * eject the customer from their queue into the browse list.
 */
export function queueStateToQuery(s: QueueState, extra?: Record<string, string>): string {
  const qs = new URLSearchParams();
  if (!extra?.bucket) qs.set("queue", "all");
  if (s.q) qs.set("q", s.q);
  if (s.severity) qs.set("severity", s.severity);
  if (s.domain) qs.set("domain", s.domain);
  if (s.governance) qs.set("governance", s.governance);
  if (s.operational) qs.set("operational", s.operational);
  if (s.due) qs.set("due", s.due);
  if (s.assignedToMe) qs.set("mine", "1");
  if (s.hasAction) qs.set("has_action", "1");
  if (s.hasEvidence) qs.set("has_evidence", "1");
  if (s.createdFrom) qs.set("created_from", s.createdFrom);
  if (s.createdTo) qs.set("created_to", s.createdTo);
  if (s.sort !== "urgency") qs.set("sort", s.sort);
  if (s.page > 1) qs.set("page", String(s.page));
  for (const [k, v] of Object.entries(extra ?? {})) qs.set(k, v);
  return qs.toString();
}

export function queueHref(s: QueueState, extra?: Record<string, string>): string {
  return `/findings?${queueStateToQuery(s, extra)}`;
}

/**
 * Change one field. Any filter/search/sort change resets to page 1 (a filtered
 * result set has fewer pages; keeping a stale page would land on emptiness).
 * Only an explicit page change preserves the page.
 */
export function withField<K extends keyof QueueState>(
  s: QueueState,
  key: K,
  value: QueueState[K]
): QueueState {
  const next = { ...s, [key]: value };
  if (key !== "page") next.page = 1;
  return next;
}

/** The active-filter chips (one per set filter), each with the key to clear. */
export interface FilterChip {
  key: keyof QueueState;
  label: string;
}

export function activeFilterChips(s: QueueState): FilterChip[] {
  const chips: FilterChip[] = [];
  if (s.q) chips.push({ key: "q", label: `Search: "${s.q}"` });
  if (s.severity) chips.push({ key: "severity", label: `Severity: ${s.severity}` });
  if (s.domain) chips.push({ key: "domain", label: `Domain: ${s.domain}` });
  if (s.governance) chips.push({ key: "governance", label: `Governance: ${GOVERNANCE_LABELS[s.governance] ?? s.governance}` });
  if (s.operational) chips.push({ key: "operational", label: `Operational: ${OPERATIONAL_LABELS[s.operational] ?? s.operational}` });
  if (s.due) chips.push({ key: "due", label: DUE_LABELS[s.due as FindingsDueStatus] ?? s.due });
  if (s.assignedToMe) chips.push({ key: "assignedToMe", label: "Assigned to me" });
  if (s.hasAction) chips.push({ key: "hasAction", label: "Has remediation action" });
  if (s.hasEvidence) chips.push({ key: "hasEvidence", label: "Has evidence" });
  if (s.createdFrom) chips.push({ key: "createdFrom", label: `From ${s.createdFrom}` });
  if (s.createdTo) chips.push({ key: "createdTo", label: `To ${s.createdTo}` });
  return chips;
}

/** Reset one filter to its empty value (and go back to page 1). */
export function clearFilter(s: QueueState, key: keyof QueueState): QueueState {
  const empty = EMPTY_QUEUE_STATE[key];
  return withField(s, key, empty as QueueState[typeof key]);
}

/** Clear ALL filters + search, keeping the sort. Resets to page 1. */
export function clearAllFilters(s: QueueState): QueueState {
  return { ...EMPTY_QUEUE_STATE, sort: s.sort };
}

// ── Pagination ──────────────────────────────────────────────────────────────

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
}

/** Inclusive 1-based index range of the current page, e.g. "26–50 of 214". */
export function resultRangeLabel(page: number, count: number, total: number): string {
  if (total === 0 || count === 0) return "No findings";
  const start = (page - 1) * QUEUE_PAGE_SIZE + 1;
  const end = start + count - 1;
  return `${start}–${end} of ${total}`;
}

export interface Pager {
  page: number;
  pages: number;
  prevHref: string | null;
  nextHref: string | null;
}

export function buildPager(s: QueueState, total: number, extra?: Record<string, string>): Pager {
  const pages = pageCount(total);
  const page = Math.min(Math.max(1, s.page), pages);
  return {
    page,
    pages,
    prevHref: page > 1 ? queueHref(withField(s, "page", page - 1), extra) : null,
    nextHref: page < pages ? queueHref(withField(s, "page", page + 1), extra) : null,
  };
}

// ── Bucket refinement (Operations Center) ───────────────────────────────────
//
// A bucket's definition (workQueues.OPS_BUCKETS target.params) is an IMPLICIT
// filter — it defines the queue and is never user-clearable. The toolbar refines
// WITHIN it. Two rules keep that honest:
//
//   1. the bucket's params are spread LAST into the fetch, so a user filter can
//      never override the bucket's population (membership stays enforced);
//   2. a toolbar axis the bucket already pins (e.g. Governance in the Needs
//      Governance Decision bucket) is dropped from the state and hidden from the
//      toolbar — a control whose value the bucket overrides would be a lying
//      control, and a stale URL param on that axis must not render a fake chip.

/** The toolbar axes a bucket definition can pin. */
export type PinnableFilterKey = "governance" | "operational" | "domain" | "due" | "assignedToMe";

/**
 * The toolbar axes this bucket's implicit params already determine.
 *  - decision_state / ready_for_decision pin the Governance axis
 *  - operational_status / ready_for_decision pin the Operational axis
 *  - domain pins Domain
 *  - overdue pins Due status (every member is overdue by definition)
 *  - owner / unassigned pin Assigned-to-me (already scoped / contradictory)
 * `active: true` pins nothing — an operational refinement composes with it.
 */
export function pinnedFilterKeys(params: FindingsParams): Set<PinnableFilterKey> {
  const pinned = new Set<PinnableFilterKey>();
  if (params.decision_state !== undefined || params.ready_for_decision) pinned.add("governance");
  if (params.operational_status !== undefined || params.ready_for_decision) pinned.add("operational");
  if (params.domain !== undefined) pinned.add("domain");
  if (params.overdue) pinned.add("due");
  if (params.owner !== undefined || params.unassigned) pinned.add("assignedToMe");
  return pinned;
}

/** Drop user filters on pinned axes (stale URL params must not fight the bucket). */
export function clearPinnedFilters(s: QueueState, pinned: Set<PinnableFilterKey>): QueueState {
  const next = { ...s };
  if (pinned.has("governance")) next.governance = "";
  if (pinned.has("operational")) next.operational = "";
  if (pinned.has("domain")) next.domain = "";
  if (pinned.has("due")) next.due = "";
  if (pinned.has("assignedToMe")) next.assignedToMe = false;
  return next;
}

/**
 * The server fetch params for a bucket view refined by the toolbar: the user's
 * search/filter/sort/page, with the bucket's implicit params spread LAST so
 * membership is enforced no matter what the URL carries.
 */
export function bucketQueueParams(s: QueueState, bucketParams: FindingsParams): FindingsParams {
  return {
    ...queueStateToParams(clearPinnedFilters(s, pinnedFilterKeys(bucketParams))),
    ...bucketParams,
  };
}
