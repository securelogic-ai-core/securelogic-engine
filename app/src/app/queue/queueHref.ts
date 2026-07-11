/**
 * queueHref.ts — the single place a /queue URL is built.
 *
 * WHY IT EXISTS: the page used to construct queue links in three separate places
 * (the pagination helper, the target-type chips, and the "All" chip via a regex
 * strip). Each one rebuilt the query string from scratch and knew a different
 * subset of the state. That is precisely how B4 happened: the finding scope
 * (`signal_id`) is easy to add to one of them and forget in the other two, and the
 * failure is silent — the user clicks a filter and is quietly dumped back into the
 * org-wide 4000-row queue with no indication anything was lost.
 *
 * One builder, one set of rules, unit-tested. A link cannot drop state it never
 * had the chance to forget.
 */

export type QueueSort = "created-desc" | "score-desc";

export type QueueStatus = "pending" | "accepted" | "dismissed";

export interface QueueQuery {
  /** Filter to one entity type. Undefined = all types. */
  targetType?: string;
  /** Scope to the suggestions for one signal (i.e. one finding). Undefined = org-wide. */
  signalId?: string;
  /** Free-text filter on the entity the suggestion is about (R3). */
  q?: string;
  /** Review state. Undefined = pending (the default queue). */
  status?: QueueStatus;
  sort?: QueueSort;
  offset?: number;
}

const DEFAULT_SORT: QueueSort = "created-desc";
const DEFAULT_STATUS: QueueStatus = "pending";

/**
 * Build a /queue href. Omits anything at its default so the common URL stays
 * clean (`/queue`, not `/queue?sort=created-desc&offset=0`).
 */
export function buildQueueHref(query: QueueQuery = {}): string {
  const qs = new URLSearchParams();
  if (query.targetType) qs.set("target_type", query.targetType);
  if (query.signalId) qs.set("signal_id", query.signalId);
  if (query.q && query.q.trim()) qs.set("q", query.q.trim());
  if (query.status && query.status !== DEFAULT_STATUS) qs.set("status", query.status);
  if (query.sort && query.sort !== DEFAULT_SORT) qs.set("sort", query.sort);
  if (typeof query.offset === "number" && query.offset > 0) qs.set("offset", String(query.offset));
  const s = qs.toString();
  return s ? `/queue?${s}` : "/queue";
}

export function isQueueStatus(v: string | undefined): v is QueueStatus {
  return v === "pending" || v === "accepted" || v === "dismissed";
}

/**
 * The engine bounds q at 2..120 chars and 400s outside that. Validate at the edge so
 * a too-short search degrades to "no filter" rather than an error page — the same
 * posture as a malformed signal_id.
 */
export function normalizeQueueQuery(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  if (t.length < 2 || t.length > 120) return undefined;
  return t;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The engine 400s a non-uuid signal_id. Validate at the edge so a malformed deep
 * link degrades to the unfiltered queue rather than an error page — a bad link
 * should lose the scope, not the page.
 */
export function isUuid(v: string | undefined): v is string {
  return v !== undefined && UUID_RE.test(v);
}
