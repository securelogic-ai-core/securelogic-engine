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

export interface QueueQuery {
  /** Filter to one entity type. Undefined = all types. */
  targetType?: string;
  /** Scope to the suggestions for one signal (i.e. one finding). Undefined = org-wide. */
  signalId?: string;
  sort?: QueueSort;
  offset?: number;
}

const DEFAULT_SORT: QueueSort = "created-desc";

/**
 * Build a /queue href. Omits anything at its default so the common URL stays
 * clean (`/queue`, not `/queue?sort=created-desc&offset=0`).
 */
export function buildQueueHref(q: QueueQuery = {}): string {
  const qs = new URLSearchParams();
  if (q.targetType) qs.set("target_type", q.targetType);
  if (q.signalId) qs.set("signal_id", q.signalId);
  if (q.sort && q.sort !== DEFAULT_SORT) qs.set("sort", q.sort);
  if (typeof q.offset === "number" && q.offset > 0) qs.set("offset", String(q.offset));
  const s = qs.toString();
  return s ? `/queue?${s}` : "/queue";
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
