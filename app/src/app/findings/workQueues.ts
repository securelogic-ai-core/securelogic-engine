/**
 * workQueues.ts — pure logic for the Findings operations center (ERIP).
 *
 * SecureLogic customers manage WORK, not records: the landing experience is a set
 * of decision buckets — workflow work (Needs Assignment, SLA Breached, Needs
 * Decision, Awaiting Approval, Review Suggested Links) and risk-domain work
 * (Active Exploitation, Regulatory Impact, AI Risk, Third-Party Risk). Clicking a
 * bucket opens a SUBORDINATE, SERVER-FILTERED findings view (or the owning
 * surface: /approvals, /queue). Counts are server truth from /findings/summary —
 * never client-side filtering of a page, so buckets stay correct at 20k findings.
 *
 * Dependency-free (no React) so it is unit-testable without a DOM/RTL harness.
 * No new data model: buckets map onto existing fields, the risk lifecycle
 * (risk_approvals), the matcher queue, and the intelligence pipeline's
 * exploitation evidence.
 */

import type { FindingsSummary, FindingsParams } from "@/lib/api";

export type OpsBucketId =
  | "my_work"
  | "needs_assignment"
  | "sla_breached"
  | "needs_decision"
  | "ready_to_close"
  | "pending_independent_review"
  | "awaiting_approval"
  | "review_links"
  | "active_exploitation"
  | "regulatory"
  | "ai_risk"
  | "third_party"
  | "in_mitigation"
  | "accepted_risk";

export type OpsBucketGroup = "decisions" | "domains" | "tracking";

export interface OpsBucketDef {
  id: OpsBucketId;
  label: string;
  /** The work the bucket represents — decision framing, not record framing. */
  ask: string;
  group: OpsBucketGroup;
  /** Non-zero count means work is due now (drives urgency styling). */
  urgent: boolean;
  /**
   * Which lifecycle axis the bucket tracks (F-3). Surfaced as a tag so a
   * governance record (Accepted Risk) is never read as equivalent to
   * operational tracking (In Mitigation). Omitted where the label already makes
   * the axis unambiguous.
   */
  axisTag?: "Governance" | "Operational";
  /**
   * Where the bucket opens. `findings` buckets open the subordinate findings view
   * with SERVER-side filters; `href` buckets open the surface that owns that work.
   */
  target: { kind: "findings"; params: FindingsParams } | { kind: "href"; href: string };
  /**
   * Why a finding is IN this queue (MW-7) — the membership criterion stated as
   * a fact about the finding, shown on every card in the bucket. Must restate
   * the target filter truthfully; my_work instead derives its reason from the
   * caller (whyInMyWork).
   */
  membershipReason?: string;
}

/** The operations-center buckets, grouped. Order within a group = display order. */
export const OPS_BUCKETS: readonly OpsBucketDef[] = [
  // ── Decision work ─────────────────────────────────────────────
  { id: "my_work", label: "My Work", ask: "Assigned to you and still requires action", group: "decisions", urgent: true, target: { kind: "findings", params: { owner: "me", active: true } } },
  { id: "sla_breached", label: "SLA Breached", ask: "Past the committed date — act or renegotiate", group: "decisions", urgent: true, membershipReason: "Past its due date", target: { kind: "findings", params: { overdue: true } } },
  { id: "needs_assignment", label: "Needs Assignment", ask: "No accountable owner yet", group: "decisions", urgent: true, membershipReason: "No owner assigned yet", target: { kind: "findings", params: { unassigned: true } } },
  { id: "needs_decision", label: "Needs Governance Decision", ask: "No risk-treatment decision recorded — triage", group: "decisions", urgent: true, membershipReason: "No governance decision recorded yet", target: { kind: "findings", params: { decision_state: "needs_review", active: true } } },
  // Ready-for-decision queue (finding-lifecycle-spec §1.3): remediation work is
  // DERIVED complete (operational_status=remediated) but leadership hasn't made
  // the governance call. A query, never an automated decision (R3).
  { id: "ready_to_close", label: "Ready to Close", ask: "Remediation complete — make the governance call", group: "decisions", urgent: true, membershipReason: "Remediation complete — governance decision pending", target: { kind: "findings", params: { ready_for_decision: true } } },
  { id: "awaiting_approval", label: "Awaiting Approval", ask: "Risk treatments pending executive sign-off", group: "decisions", urgent: true, target: { kind: "href", href: "/approvals" } },
  { id: "review_links", label: "Review Suggested Links", ask: "Intelligence matched your entities — confirm or dismiss", group: "decisions", urgent: true, target: { kind: "href", href: "/queue" } },
  // ── Risk domains ──────────────────────────────────────────────
  { id: "active_exploitation", label: "Active Exploitation", ask: "Exploitation observed in the wild — highest urgency", group: "domains", urgent: true, membershipReason: "Its source signal has exploitation observed in the wild", target: { kind: "findings", params: { exploited: true, active: true } } },
  { id: "regulatory", label: "Regulatory Impact", ask: "Compliance obligations exposed", group: "domains", urgent: false, membershipReason: "In the Regulatory risk domain", target: { kind: "findings", params: { domain: "Regulatory", active: true } } },
  { id: "ai_risk", label: "AI Risk", ask: "AI systems under governance exposure", group: "domains", urgent: false, membershipReason: "In the AI Governance risk domain", target: { kind: "findings", params: { domain: "AI Governance", active: true } } },
  { id: "third_party", label: "Third-Party Risk", ask: "Vendor and supply-chain exposure", group: "domains", urgent: false, membershipReason: "In the Vendor Risk domain", target: { kind: "findings", params: { domain: "Vendor Risk", active: true } } },
  // ── Tracking ──────────────────────────────────────────────────
  { id: "in_mitigation", label: "In Mitigation", ask: "Remediation plan underway — track to done", group: "tracking", urgent: false, axisTag: "Operational", membershipReason: "Governance decision: mitigating — remediation being tracked", target: { kind: "findings", params: { decision_state: "mitigating", active: true } } },
  { id: "accepted_risk", label: "Accepted Risk", ask: "Governance decisions on record — periodic review", group: "tracking", urgent: false, axisTag: "Governance", membershipReason: "Governance decision: risk accepted — on the periodic review record", target: { kind: "findings", params: { decision_state: "accepted_risk" } } },
];

/**
 * Independent Governance Review — the REVIEWER-scoped twin of `ready_to_close`.
 * `ready_to_close` is the org-wide ready-for-decision population; this bucket is the
 * subset a reviewer personally owns (review_owner=me) under separation of duties.
 *
 * Labeled "My Pending Reviews" (count-scope fix, 2026-07-20): its previous label —
 * "Pending Independent Review" — was also used by the dashboard tile for the ORG-WIDE
 * population, so one name carried two scopes and a reviewer with 1 assigned review
 * read the org total (5) as theirs. The personal scope is now in the name. The bucket
 * ID is deliberately NOT renamed — in-flight links and open tabs must keep resolving.
 *
 * DELIBERATELY NOT a member of the default OPS_BUCKETS grid: it is surfaced ONLY when
 * the independent-review rollout flag is on (opts.independentReview). Keeping it out of
 * the static array is what makes the flag-OFF operations center byte-identical — the pure
 * iterators (dueWorkCount) never see it, and it is unreachable as a subordinate view
 * (opsBucket returns null for its id) unless the flag is passed.
 */
export const INDEPENDENT_REVIEW_BUCKET: OpsBucketDef = {
  id: "pending_independent_review",
  label: "My Pending Reviews",
  ask: "Assigned to you to validate and close — remediation is complete",
  group: "decisions",
  urgent: true,
  axisTag: "Governance",
  membershipReason: "Assigned to you for independent governance review — remediation complete",
  target: { kind: "findings", params: { ready_for_decision: true, review_owner: "me" } },
};

/** Flag inputs that expose rollout-gated buckets. Default all-off ⇒ legacy behaviour. */
export interface OpsBucketFlags {
  /** SECURELOGIC_INDEPENDENT_REVIEW_ENABLED — surfaces the reviewer queue bucket. */
  independentReview?: boolean;
}

export const OPS_GROUP_LABELS: Record<OpsBucketGroup, string> = {
  decisions: "Work queues",
  domains: "Risk domains",
  tracking: "Tracking — operational vs. governance",
};

export function opsBucket(
  id: string | undefined,
  flags: OpsBucketFlags = {}
): OpsBucketDef | null {
  if (id === INDEPENDENT_REVIEW_BUCKET.id) {
    return flags.independentReview ? INDEPENDENT_REVIEW_BUCKET : null;
  }
  return OPS_BUCKETS.find((b) => b.id === id) ?? null;
}

/**
 * Buckets in display order for one group. Rollout-gated buckets are appended only when
 * their flag is on (default off ⇒ the legacy static set, byte-identical).
 */
export function bucketsInGroup(
  group: OpsBucketGroup,
  flags: OpsBucketFlags = {}
): OpsBucketDef[] {
  const base = OPS_BUCKETS.filter((b) => b.group === group);
  if (flags.independentReview && group === INDEPENDENT_REVIEW_BUCKET.group) {
    base.push(INDEPENDENT_REVIEW_BUCKET);
  }
  return base;
}

/** The /findings URL that opens a bucket's subordinate view (or the owning surface). */
export function bucketHref(b: OpsBucketDef): string {
  return b.target.kind === "href" ? b.target.href : `/findings?bucket=${b.id}`;
}

/** Server-side page size for bucket views. */
export const BUCKET_PAGE_SIZE = 25;

/**
 * The server-side list params for one PAGE of a findings bucket (null for href
 * buckets). Always the stable keyset sort (created_at DESC, id DESC) so pages
 * never skip or duplicate rows as findings change between requests.
 */
export function bucketListParams(
  b: OpsBucketDef,
  cursor?: { created_at: string; id: string } | null
): FindingsParams | null {
  if (b.target.kind !== "findings") return null;
  return {
    ...b.target.params,
    sort: "created",
    ...(cursor ? { before: cursor } : {}),
    limit: BUCKET_PAGE_SIZE,
  };
}

export interface OpsCounts {
  counts: Record<OpsBucketId, number>;
  /** Ids whose count came from a missing summary field (shown as em-dash, never a fake 0). */
  unknown: OpsBucketId[];
}

/**
 * Server-truth counts for every bucket from the extended /findings/summary (+ the
 * matcher queue's pending total). A missing field (older engine) is reported as
 * UNKNOWN rather than a lying zero.
 */
export function opsCounts(
  summary: FindingsSummary | undefined,
  pendingSuggestions: number | null
): OpsCounts {
  const counts = {} as Record<OpsBucketId, number>;
  const unknown: OpsBucketId[] = [];
  const take = (id: OpsBucketId, v: number | null | undefined) => {
    if (typeof v === "number") counts[id] = v;
    else {
      counts[id] = 0;
      unknown.push(id);
    }
  };
  take("my_work", summary?.my_work_open);
  // Reviewer-scoped independent-review queue (session-scoped field; absent for API-key
  // callers → UNKNOWN em-dash, never a lying zero). Only rendered when the rollout flag
  // surfaces the bucket, but the count is resolved here so the record stays complete.
  take("pending_independent_review", summary?.my_pending_reviews_open);
  take("sla_breached", summary?.overdue_open);
  take("needs_assignment", summary?.unassigned_open);
  take("needs_decision", summary?.needs_review_open);
  take("ready_to_close", summary?.ready_for_decision_open);
  take("awaiting_approval", summary?.pending_risk_approvals);
  take("review_links", pendingSuggestions);
  take("active_exploitation", summary?.exploited_open);
  take("regulatory", summary?.regulatory_open);
  take("ai_risk", summary?.ai_governance_open);
  take("third_party", summary?.vendor_risk_open);
  take("in_mitigation", summary?.mitigating_open);
  take("accepted_risk", summary?.accepted_risk_total);
  return { counts, unknown };
}

/** Total items of due decision work (drives the all-clear state). */
export function dueWorkCount(c: Record<OpsBucketId, number>): number {
  return OPS_BUCKETS.filter((b) => b.urgent).reduce((n, b) => n + (c[b.id] ?? 0), 0);
}

/* ── Global summary bar (F-1) ─────────────────────────────────────────────
 * A concise headline strip at the top of the operations center: the five
 * numbers a leader wants first. Every value comes from /findings/summary via
 * the SAME server COUNT(*)s the buckets use (never a client scan) — so a
 * headline can never disagree with the bucket it links to. A field the engine
 * does not serve yet is UNKNOWN ("—"), never a lying zero.
 */

export type SummaryTone = "urgent" | "attention" | "neutral" | "governance";

export interface SummaryItem {
  key: "active" | "accepted_risk" | "awaiting_approval" | "ready_to_close" | "overdue";
  label: string;
  /** null → render as "—" (engine build predates the field). */
  value: number | null;
  tone: SummaryTone;
  /** Where the headline drills through (a bucket view or an owning surface). */
  href: string;
  /** Short explanation shown under the number. */
  hint: string;
}

/** The ordered headline metrics for the operations-center summary bar. */
export function globalSummary(summary: FindingsSummary | undefined): SummaryItem[] {
  const n = (v: number | null | undefined): number | null => (typeof v === "number" ? v : null);
  return [
    {
      key: "active",
      label: "Active Findings",
      value: n(summary?.active_total),
      tone: "neutral",
      href: "/findings?active=true",
      hint: "Open or in-progress — still require work",
    },
    {
      key: "overdue",
      label: "Overdue / SLA",
      value: n(summary?.overdue_open),
      tone: "urgent",
      href: "/findings?bucket=sla_breached",
      hint: "Past the committed date",
    },
    {
      key: "awaiting_approval",
      label: "Awaiting Approval",
      value: n(summary?.pending_risk_approvals),
      tone: "attention",
      href: "/approvals",
      hint: "Risk treatments pending sign-off",
    },
    {
      key: "ready_to_close",
      label: "Ready to Close",
      value: n(summary?.ready_for_decision_open),
      tone: "governance",
      href: "/findings?bucket=ready_to_close",
      hint: "Remediation complete — governance decision required",
    },
    {
      key: "accepted_risk",
      label: "Accepted Risk",
      value: n(summary?.accepted_risk_total),
      tone: "governance",
      href: "/findings?bucket=accepted_risk",
      hint: "Governance decisions on record",
    },
  ];
}

/* ── Keyset pagination (bucket views) ─────────────────────────────
 * Cursor-based so pages never duplicate or drop rows when findings change
 * between requests (an offset would). "Previous" is a bounded trail of the
 * cursors that led here, carried in the URL; invalid input always fails safe
 * to the first page.
 */

export interface PageCursor {
  created_at: string;
  id: string;
}

const CURSOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRAIL = 50;

/** Encode a cursor into a URL token. */
export function encodeCursor(c: PageCursor): string {
  return `${c.created_at}~${c.id}`;
}

/** Decode a URL token; null on ANY invalid input (fail-safe → first page). */
export function decodeCursor(token: string | undefined | null): PageCursor | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 80) return null;
  const sep = token.lastIndexOf("~");
  if (sep <= 0) return null;
  const created_at = token.slice(0, sep);
  const id = token.slice(sep + 1);
  if (!CURSOR_UUID_RE.test(id)) return null;
  if (Number.isNaN(Date.parse(created_at))) return null;
  return { created_at, id };
}

/** Parse the prior-cursor trail param (comma-separated tokens, bounded, invalid dropped). */
export function parseTrail(raw: string | undefined | null): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw
    .split(",")
    .slice(0, MAX_TRAIL)
    .filter((t) => decodeCursor(t) !== null);
}

export interface BucketPageHrefs {
  nextHref: string | null;
  prevHref: string | null;
}

/**
 * Build the next/previous URLs for a bucket page, preserving the bucket (its
 * filters are derived server-side from the id). Next pushes the current cursor
 * onto the trail; previous pops the trail. No next page → null (final page).
 */
export function bucketPageHrefs(
  bucketId: OpsBucketId,
  after: string | null,
  trail: string[],
  nextCursor: PageCursor | null
): BucketPageHrefs {
  const base = `/findings?bucket=${bucketId}`;
  const qs = (afterTok: string | null, trailToks: string[]) => {
    let href = base;
    if (afterTok) href += `&after=${encodeURIComponent(afterTok)}`;
    if (trailToks.length > 0) href += `&trail=${encodeURIComponent(trailToks.join(","))}`;
    return href;
  };
  const nextHref =
    nextCursor === null
      ? null
      : qs(encodeCursor(nextCursor), after ? [...trail, after].slice(-MAX_TRAIL) : trail);
  const prevHref =
    after === null ? null : trail.length === 0 ? base : qs(trail[trail.length - 1]!, trail.slice(0, -1));
  return { nextHref, prevHref };
}

export interface PageRange {
  start: number;
  end: number;
}

/**
 * Displayed range for the current page. Depth derives from the trail (pages
 * before this one); with keyset paging the range is exact at page-load time and
 * approximate only if items changed since — which is the honest tradeoff for
 * never duplicating or dropping rows.
 */
export function pageRange(after: string | null, trail: string[], pageCount: number): PageRange {
  if (pageCount === 0) return { start: 0, end: 0 };
  const depth = after === null ? 0 : trail.length + 1;
  const start = depth * BUCKET_PAGE_SIZE + 1;
  return { start, end: start + pageCount - 1 };
}
