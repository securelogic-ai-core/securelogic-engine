"use client";

/**
 * DecisionWorkspace — ERIP Package 3, Phase 3.2b.
 *
 * The Decision Workspace render for a Finding: the enterprise decision object.
 * Zones A–G (design §3) consuming GET /api/findings/:id/context. Progressive
 * disclosure: A/B/C/F always expanded (executive read); D/E collapsible
 * (analyst). Rendered ONLY when SECURELOGIC_DECISION_WORKSPACE_ENABLED is on;
 * the flag-off page is the unchanged legacy detail (byte-identical).
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Finding,
  Action,
  FindingContext,
  FindingImpactDimension,
  AffectedResolution,
  FindingCandidateEntity,
  RiskAcceptance,
} from "@/lib/api";
import { intelligenceEventHref, findingEventId } from "@/lib/intelligenceLinks";
import {
  queueHandoffLabel,
  safeQueueReturnUrl,
  queueHandoffFallbackHref,
} from "../queueHandoff";
import { RiskAcceptancePanel } from "./RiskAcceptancePanel";
import { GovernanceBanner } from "./GovernanceBanner";
import { GovernanceDecisionPanel } from "./GovernanceDecisionPanel";
import { DECISION_TABS, DEFAULT_DECISION_TAB, isDecisionTab, type DecisionTab } from "./decisionTabs";
import { legalDecisionTargets } from "./decisionTransitions";
import { intelligenceEmptyCopy } from "./findingSourceCopy";
import { topBusinessImpact } from "./businessImpact";
import { RELATION_LABEL } from "./relationHierarchy";
import { evidenceRefHref } from "@/lib/evidenceLinks";
import {
  GOVERNANCE_AXIS_LABEL,
  OPERATIONAL_AXIS_LABEL,
  DECISION_STATE_LABELS,
  DECISION_STATE_MEANINGS,
  OperationalStateBadge,
  LifecycleIndicator,
  lifecycleSummary,
} from "@/lib/findingLifecycleVocab";
import {
  updateFindingPriorityAction,
  updateFindingDecisionStateAction,
  markFindingReviewedAction,
  assignFindingOwnerAction,
} from "./actions";

// Canonical governance labels (shared module) — the Decision Workspace was one of
// the screens that re-declared these; it now imports the single source of truth.
const DECISION_LABELS = DECISION_STATE_LABELS;
// Legacy `finding.status` (open/in_progress/closed/accepted) is no longer surfaced
// in the workspace — it is an internal migration concept superseded by the two
// canonical axes (Governance Decision + Operational Status). The field and its
// server-side enforcement are unchanged; only the customer-facing control is gone.

const LEVEL_COLOR: Record<string, string> = {
  high: "#fca5a5",
  medium: "#fcd34d",
  low: "#86efac",
  none: "#64748b",
  not_assessed: "#475569",
};
const LEVEL_LABEL: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
  not_assessed: "Not assessed",
};

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const ENTITY_ROUTE: Record<string, string> = {
  vendor: "/vendors",
  ai_system: "/ai-systems",
  control: "/controls",
  obligation: "/obligations",
  // C5: canonical Enterprise Assets deep-link to the registry detail page.
  asset: "/assets",
};

const ENTITY_TYPE_LABEL: Record<string, string> = {
  vendor: "Vendor",
  ai_system: "AI System",
  control: "Control",
  obligation: "Obligation",
  asset: "Asset",
};

/**
 * A business-impact dimension (B-11). Each dimension is now actionable: it lists
 * and links the underlying entities that make it real — Operational → controls &
 * AI systems, Regulatory → obligations, Third-party → vendors — so clicking the
 * impact takes you to what to actually look at, instead of an inert level chip.
 */
function ImpactRow({
  label,
  dim,
  entities,
}: {
  label: string;
  dim: FindingImpactDimension;
  entities: { type: string; id: string; name: string }[];
}) {
  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 96, fontSize: 12, color: "#94a3b8" }}>{label}</span>
      <Chip text={LEVEL_LABEL[dim.level] ?? dim.level} color={LEVEL_COLOR[dim.level] ?? "#94a3b8"} />
      <span style={{ fontSize: 12, color: "#64748b" }}>{dim.note}</span>
    </div>
  );
  if (entities.length === 0) return header;
  return (
    <details>
      <summary style={{ cursor: "pointer", listStyle: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {header}
          <span style={{ fontSize: 11, color: "#93c5fd" }}>· {entities.length} linked →</span>
        </span>
      </summary>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0 4px 104px" }}>
        {entities.map((e) => (
          <Link key={`${e.type}:${e.id}`} href={`${ENTITY_ROUTE[e.type] ?? "#"}/${e.id}`} style={{ fontSize: 12, color: "#93c5fd" }}>
            <span style={{ color: "#64748b" }}>{ENTITY_TYPE_LABEL[e.type] ?? e.type}: </span>
            {e.name}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** Humanize an audit event_type into a workflow-transition label (DW-9). */
const ACTIVITY_LABELS: Record<string, string> = {
  "finding.created": "Finding created",
  "finding.promoted_from_signal": "Promoted from intelligence signal",
  "finding.reviewed": "Reviewed",
  "finding.assigned": "Owner assigned",
  "finding.owner_assigned": "Owner assigned",
  "finding.remediated": "Remediation completed",
  "finding.operational.advanced": "Remediation progressed",
  "finding.reopened": "Reopened",
  "finding.decision.accepted_risk": "Governance: risk accepted",
  "finding.decision.mitigating": "Governance: mitigation plan accepted",
  "finding.decision.resolved": "Governance: closed (resolved)",
  "finding.decision.needs_review": "Governance: sent back for review",
  "finding.evidence_attached": "Evidence attached",
  "action.created": "Remediation action added",
  "action.unblocked": "Remediation action unblocked",
};

/** Action status → past-tense transition label (action.status_changed payload).
 *  Statuses are the actions table CHECK set: open | in_progress | blocked |
 *  closed | accepted. */
const ACTION_STATUS_LABELS: Record<string, string> = {
  open: "Remediation action reopened",
  in_progress: "Remediation action started",
  blocked: "Remediation action blocked",
  closed: "Remediation action completed",
  accepted: "Remediation action accepted",
};

function activityLabel(eventType: string, payload?: unknown): string {
  if (ACTIVITY_LABELS[eventType]) return ACTIVITY_LABELS[eventType];
  // The engine writes action.status_changed / action.updated with the action's
  // resulting state in the payload — the actual remediation + reassignment
  // history (owner and due-date changes arrive as action.updated).
  const p = (payload ?? {}) as { status?: string | null };
  if (eventType === "action.status_changed" && p.status && ACTION_STATUS_LABELS[p.status]) {
    return ACTION_STATUS_LABELS[p.status];
  }
  if (eventType === "action.updated") {
    return "Remediation action updated (owner / due date / details)";
  }
  // Fall back to a readable form of the raw event name.
  return eventType
    .replace(/^finding\./, "")
    .replace(/^action\./, "Action: ")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Audit-grade Activity timeline (rendering correctness) ──────────────────────
// An audit entry answers WHEN (exact, unambiguous), WHO, WHAT changed, on WHICH
// action, and — for a block/unblock — WHY. Each helper is a pure projection of one
// activity row so it is unit-testable and the JSX below stays declarative.

type ActivityItem = FindingContext["activity"][number];

/** Action status → human label, for prior→new transitions. Mirrors the actions
 *  CHECK set (open | in_progress | blocked | closed | accepted). */
const STATUS_HUMAN: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  closed: "Completed",
  accepted: "Accepted",
};

/** Exact, clearly-labeled UTC timestamp — date AND time, never a bare date (the
 *  original defect). Server-rendered deterministically; the "UTC" suffix removes
 *  any ambiguity about whose clock this is. */
function fmtActivityTimestamp(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return (
    date.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " UTC"
  );
}

/** WHO acted: display name, then email, then an honest "System" for
 *  scheduler / API-key events with no human actor. Never a raw UUID. */
function activityActor(a: ActivityItem): string {
  const name = typeof a.actor_name === "string" ? a.actor_name.trim() : "";
  if (name) return name;
  const email = typeof a.actor_email === "string" ? a.actor_email.trim() : "";
  if (email) return email;
  return "System";
}

/** WHICH action an entry is about: the action's title, then a payload-snapshotted
 *  title (survives a deleted action), then a short id. Null for finding-level
 *  entries — the finding is the page, so naming it would be noise. */
function activityActionIdentity(a: ActivityItem): string | null {
  if (a.resource_type !== "action") return null;
  const title = typeof a.action_title === "string" ? a.action_title.trim() : "";
  if (title) return title;
  const p = (a.payload ?? {}) as { title?: unknown };
  const snap = typeof p.title === "string" ? p.title.trim() : "";
  if (snap) return snap;
  const id = typeof a.resource_id === "string" ? a.resource_id : "";
  return id ? `Action ${id.slice(0, 8)}` : null;
}

/** Prior → new status, where the event carries it. Block/unblock and every status
 *  change now record from/to; an older status_changed at least has a destination. */
function activityTransition(a: ActivityItem): string | null {
  const p = (a.payload ?? {}) as { from?: unknown; to?: unknown; status?: unknown };
  const human = (s: unknown): string | null =>
    typeof s === "string" && s ? STATUS_HUMAN[s] ?? s : null;
  const from = human(p.from);
  const to = human(p.to) ?? human(p.status);
  if (from && to) return `${from} → ${to}`;
  if (to) return `→ ${to}`;
  return null;
}

/** The completion note carried by a completion (action.status_changed → closed).
 *  Part of the audit-grade record — WHY/HOW the remediation was completed, next to
 *  WHO and WHEN. Null when the entry is not a completion or carries no note. */
function activityCompletionNote(a: ActivityItem): string | null {
  if (a.event_type !== "action.status_changed") return null;
  const p = (a.payload ?? {}) as Record<string, unknown>;
  if (p.status !== "closed" && p.to !== "closed") return null;
  const note = typeof p.completion_note === "string" ? p.completion_note.trim() : "";
  return note ? note : null;
}

type BlockerDetail = { reason: string | null; dependency: string | null; owner: string | null; expected: string | null };

/** Blocker metadata carried by a block (action.status_changed → blocked) or an
 *  unblock (action.unblocked) — the WHY the audit trail must preserve and expose.
 *  Owner prefers a resolved name/email over the raw UUID. Null when the entry is
 *  neither, or carries no blocker at all. */
function activityBlocker(a: ActivityItem): BlockerDetail | null {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  const isBlock = a.event_type === "action.status_changed" && p.status === "blocked";
  const isUnblock = a.event_type === "action.unblocked";
  if (!isBlock && !isUnblock) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const reason = str(p.blocked_reason);
  const dependency = str(p.blocked_dependency);
  const owner = str(a.blocked_owner_name) ?? str(a.blocked_owner_email) ?? str(p.blocked_owner_user_id);
  const expected = str(p.blocked_expected_unblock_date);
  if (!reason && !dependency && !owner && !expected) return null;
  return { reason, dependency, owner, expected };
}

/** Drop accidental exact-duplicate rows (a re-render or an event fan-out that
 *  double-wrote the identical event) WITHOUT collapsing genuinely distinct events.
 *  Two rows are "the same event" only if type, resource, timestamp AND payload all
 *  match — so a finding-level rollup and the action change that triggered it (same
 *  instant, different resource) are correctly KEPT. */
function dedupeActivity(rows: ActivityItem[]): ActivityItem[] {
  const seen = new Set<string>();
  const out: ActivityItem[] = [];
  for (const a of rows) {
    const key = [
      a.event_type,
      a.resource_type ?? "",
      a.resource_id ?? "",
      a.created_at,
      JSON.stringify(a.payload ?? null),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function AffectedGroup({
  label,
  items,
  resolution,
}: {
  label: string;
  items: FindingContext["affected"]["vendors"];
  // Context Contract: 'none_found' = an honest zero; 'not_applicable' = this
  // bucket cannot be sourced for this finding's source type. Distinct copy so
  // an empty state is never mistaken for a resolver miss (or vice versa).
  resolution?: AffectedResolution;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>
        {label} ({items.length})
      </div>
      {items.length === 0 ? (
        resolution === "not_applicable" ? (
          <span style={{ fontSize: 12, color: "#475569", fontStyle: "italic" }}>
            Not resolvable from this finding&apos;s source
          </span>
        ) : resolution === "resolver_error" ? (
          // NOT "None found". This emptiness is ignorance, not a zero — saying
          // "none" here would tell an operator the blast radius is clear when the
          // truth is that we could not look. An amber warning, because acting on
          // this as if it were zero is exactly the wrong move.
          <span style={{ fontSize: 12, color: "#fbbf24" }}>
            Could not resolve — this is not a zero. Retry, or escalate if it persists.
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "#475569" }}>None found</span>
        )
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {items.map((e) => (
            <Link key={e.id} href={`${ENTITY_ROUTE[e.type] ?? "#"}/${e.id}`} style={{ fontSize: 13, color: "#93c5fd" }}>
              {e.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Suggested (not yet confirmed) entity links for this finding.
 *
 * B3: every candidate is now a Link to its entity. It rendered as dead <span>
 * text while the ACCEPTED entities directly above it — same shape, same
 * {type, id, name} — were already links via ENTITY_ROUTE. Nothing was missing but
 * the anchor.
 *
 * B4: "Review in queue" was a hardcoded href="/queue", which dropped the user into
 * the org-wide pending queue (4000+ rows) with no way back to the two suggestions
 * they were actually looking at. It now carries the finding's signal so the queue
 * opens scoped to THIS finding. All the plumbing already existed — the engine route
 * has filtered on signal_id since 20260505 and the API client already sent it; only
 * the link and the queue page never wired it up.
 */
function CandidateLinks({
  candidates,
  signalId,
}: {
  candidates: FindingCandidateEntity[];
  signalId: string | null;
}) {
  if (candidates.length === 0) return null;
  const queueHref = signalId
    ? `/queue?signal_id=${encodeURIComponent(signalId)}`
    : "/queue";
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>
        Suggested links pending review ({candidates.length})
      </div>
      {/* DW-6: say what accepting/rejecting DOES, so the review isn't a leap of faith. */}
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
        Intelligence matched these entities to this finding. Accept to confirm the link (it
        joins Affected context and drives blast-radius); reject to dismiss the suggestion.
        Neither changes the finding&apos;s governance decision.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {candidates.map((c) => (
          <div key={`${c.type}:${c.id}`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#64748b", fontSize: 11 }}>{ENTITY_TYPE_LABEL[c.type] ?? c.type}</span>
            <Link href={`${ENTITY_ROUTE[c.type] ?? "#"}/${c.id}`} style={{ fontSize: 13, color: "#93c5fd" }}>
              {c.name}
            </Link>
            {typeof c.match_score === "number" && (
              <Chip text={`Match ${Math.round(c.match_score)}/100`} color="#93c5fd" />
            )}
            {c.match_reason && (
              <span style={{ fontSize: 11, color: "#64748b" }}>· {c.match_reason}</span>
            )}
          </div>
        ))}
      </div>
      <Link href={queueHref} style={{ fontSize: 12, color: "#93c5fd", display: "inline-block", marginTop: 8 }}>
        Accept or reject in the review queue →
      </Link>
    </div>
  );
}

/**
 * Independent Governance Review — the waiting state (spec §6). Shown to the remediator
 * (and any non-reviewer) when remediation is complete but the org's separation-of-duties
 * policy means an INDEPENDENT reviewer must record the closure decision. It replaces the
 * "record decision" hand-off with an honest status: what is done, what is received, and
 * who now owns the call — never an error, and never a control the engine would refuse.
 */
function IndependentReviewWaitingCard({
  reviewer,
  evidenceCount,
  fromLabel,
  returnHref,
}: {
  reviewer: { id: string; email: string; name: string | null } | null;
  evidenceCount: number;
  fromLabel: string | null;
  returnHref: string | null;
}) {
  const reviewerName = reviewer ? reviewer.name?.trim() || reviewer.email : null;
  const Row = ({ done, label }: { done: boolean; label: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#cbd5e1" }}>
      <span style={{ color: done ? "#34d399" : "#64748b", fontWeight: 700 }}>{done ? "✓" : "•"}</span>
      <span>{label}</span>
    </div>
  );
  return (
    <div
      role="status"
      style={{
        background: "rgba(139,92,246,0.08)",
        border: "1px solid rgba(139,92,246,0.35)",
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: "#c4b5fd", fontWeight: 600, fontSize: 15 }}>
          Pending Independent Review
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          Awaiting an independent governance decision
        </span>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 13, maxWidth: 620 }}>
        Remediation is complete. Your organization requires separation of duties on closure,
        so the person who performed the remediation can’t close this finding — an independent
        reviewer must record the decision. Nothing is required from you here.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Row done label="Remediation complete" />
        <Row
          done={evidenceCount > 0}
          label={
            evidenceCount > 0
              ? `Evidence received (${evidenceCount})`
              : "Evidence received — none attached yet"
          }
        />
      </div>
      <div style={{ fontSize: 13, color: "#cbd5e1" }}>
        {reviewerName ? (
          <>
            Assigned reviewer: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{reviewerName}</span>
          </>
        ) : (
          // No eligible reviewer was assignable (spec §4): surfaced org-wide for an
          // administrator to route — never a fabricated assignment.
          <span style={{ color: "#94a3b8" }}>
            No reviewer assigned yet — surfaced to your administrators for assignment.
          </span>
        )}
      </div>
      {fromLabel && returnHref && (
        <a href={returnHref} style={{ color: "#c4b5fd", fontSize: 12, textDecoration: "underline" }}>
          ← Back to {fromLabel}
        </a>
      )}
    </div>
  );
}

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 20,
};
const H: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "#64748b", marginBottom: 10 };
/** Mini-label for the grouped operational attributes (Owner / SLA / Confidence). */
const ATTR_LABEL: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b" };
const ATTR_VALUE: React.CSSProperties = { fontSize: 13, color: "#e2e8f0" };
/** A thin divider between the stacked sections inside the Zone-A identity card. */
const ZONE_A_DIVIDER: React.CSSProperties = { paddingTop: 14, marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" };

export function DecisionWorkspace({
  finding,
  context,
  owners = [],
  riskAcceptances = null,
  riskAcceptanceFeatureOn = false,
  currentUserId = null,
  openActionCount = 0,
  homeLabel = "Findings",
  children,
  riskRegister,
}: {
  finding: Finding;
  context: FindingContext;
  /** Org members, for assigning the finding. Empty => owner renders as plain text. */
  owners?: { id: string; label: string }[];
  // A finding's acceptances + terminal history. null = the feature returned no data for
  // this request (route dark OR — with the feature on — a fetch that failed). A non-null
  // array = data in hand. NEVER infer "feature off" from null; that is what
  // `riskAcceptanceFeatureOn` is for (P0, 2026-07-15).
  riskAcceptances?: RiskAcceptance[] | null;
  // P0 (2026-07-15): whether the signed risk-acceptance workflow is configured ON (read
  // server-side from SECURELOGIC_RISK_ACCEPTANCE_ENABLED). This — NOT the presence of data
  // — decides whether the workflow owns `accepted_risk`. When on but the data is null (a
  // transient fetch failure), we show an "unavailable" notice, never the one-click side
  // door. When off (production), the legacy one-click Accept-Risk is unchanged.
  riskAcceptanceFeatureOn?: boolean;
  /** The viewer, for separation-of-duties on approve/reject. */
  currentUserId?: string | null;
  /** Non-terminal remediation Actions on this finding — passed to the Governance
   *  Decision panel so it can warn before a close the engine would refuse. */
  openActionCount?: number;
  /**
   * What `/findings` is called for this viewer — "Operations Workspace" under the
   * risk_workspace flag, else the legacy "Findings". Resolved server-side and passed
   * in, because this Workspace has its OWN flag and the two can be on independently;
   * a hardcoded label would promise a workspace the route may not render. Defaults to
   * the legacy name so the back-link is never wrong when the prop is omitted.
   */
  homeLabel?: string;
  // The recommendation + remediation-actions block (Zone F) is composed by the
  // server page (reusing AddActionForm/ActionCard) and passed in as children.
  children: React.ReactNode;
  /**
   * The Risk Register relationship panel (SL-RISK-LINK), passed in from the
   * server page which owns the fetch. Rendered as its own zone ABOVE the tabs,
   * not inside one: whether the organization is carrying this finding as a risk
   * is a governance fact about the finding, and hiding it behind a tab would
   * make activating this workspace REMOVE a capability the legacy layout shows
   * unconditionally.
   */
  riskRegister?: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  // ?tab=remediation makes the Remediation tab addressable, so a blocked-closure message
  // anywhere in the product can link straight AT the work that is blocking it. Without
  // this the link would land on the page and leave the customer to find the tab.
  const initialTab = searchParams.get("tab");
  // R-19: the queue this workspace was opened from, so the page can state WHERE the
  // user came from ("Opened from All Findings" / "Opened from Needs Governance
  // Decision") and link back to the exact queue — instead of dropping them into a
  // page that looks the same as any other. Read from the URL (not history/memory)
  // so it works in a NEW TAB. `fromQueue` is untrusted: queueHandoffLabel returns
  // null for anything malformed or unrecognized (no banner), and the return link is
  // validated safe, never trusted for data access — the finding was already fetched
  // org-scoped server-side.
  const fromQueue = searchParams.get("from");
  const fromLabel = queueHandoffLabel(fromQueue);
  const returnHref = safeQueueReturnUrl(searchParams.get("return")) ?? queueHandoffFallbackHref(fromQueue);
  const [tab, setTab] = useState<DecisionTab>(
    initialTab && isDecisionTab(initialTab) ? initialTab : DEFAULT_DECISION_TAB
  );
  // The Governance Decision panel — the REAL decision controls behind "Record
  // decision" (options + consequences + rationale + confirm/cancel). The CTA
  // used to be an in-page anchor, which scrolled but opened nothing.
  const [decisionPanelOpen, setDecisionPanelOpen] = useState(false);
  // Guarded transitions can be legitimately refused (close guard, evidence
  // gate, separation of duties) — show the refusal instead of a silent no-op.
  const [actionError, setActionError] = useState<string | null>(null);
  const [errorHref, setErrorHref] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string; remediationHref?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r?.error) {
        setActionError(null);
        setErrorHref(null);
        router.refresh();
      } else {
        setActionError(r.error);
        setErrorHref(r.remediationHref ?? null);
      }
    });

  const affected = context.affected;
  const affectedTotal =
    affected.vendors.length +
    affected.ai_systems.length +
    affected.controls.length +
    affected.obligations.length +
    // C5: absent while the convergence is dark, so this adds 0 and the count is
    // identical to pre-C5.
    (affected.assets?.length ?? 0);
  const bi = context.business_impact;
  // Headline is a PURE FUNCTION of all five dimension rows rendered in Zone C
  // below, so the header chip can never contradict the detail. Honest about
  // none/not_assessed — no "?? low" floor (workflow-consistency Phase 2).
  const topImpact = topBusinessImpact([
    bi.operational.level,
    bi.regulatory.level,
    bi.third_party.level,
  ]);

  // When the signed risk-acceptance workflow is active, it OWNS accepted_risk: the
  // legacy one-click "Accept Risk" (a status someone types) is replaced by propose →
  // approve, and the decision dropdown no longer offers accepted_risk as a target — the
  // only exception is when the finding already IS accepted_risk, so its current value
  // still renders. When the feature is dark, nothing here changes.
  // P0 (2026-07-15): the workflow owns accepted_risk whenever it is CONFIGURED ON — decided
  // by the flag, not by whether data happened to load. This keeps the dropdown filter and
  // the one-click suppression aligned with the ENGINE, which 409s a direct accepted_risk
  // write while the flag is on regardless of what the client fetched.
  const riskAcceptanceActive = riskAcceptanceFeatureOn;
  const decisionState = context.finding.decision_state;
  const opStatus = context.finding.operational_status ?? null;

  // ── Independent Governance Review (spec §6) ────────────────────────────────
  // The engine projects `review.independent_review_active` (workflow flag ON AND the
  // org enforces closure separation of duties). When active and a remediated finding
  // still awaits its governance decision, the person who did the remediation — indeed
  // anyone who is NOT the assigned reviewer — must NOT be offered the Resolved /
  // Accept-Risk controls the close-time SoD gate would refuse. They see a waiting state
  // instead; only the assigned reviewer keeps the close controls. When inactive (flag
  // off or SoD not enforced) every value below is falsy → the workspace is unchanged.
  const review = context.review;
  const independentReviewActive = review?.independent_review_active ?? false;
  const reviewer = review?.reviewer ?? null;
  const pendingIndependentReview =
    independentReviewActive &&
    opStatus === "remediated" &&
    decisionState !== "resolved" &&
    decisionState !== "accepted_risk";
  const viewerIsReviewer = !!(reviewer && currentUserId && reviewer.id === currentUserId);
  // The waiting state applies to every viewer who is not the assigned reviewer (the
  // remediator is the primary case). Null reviewer ⇒ nobody is the reviewer yet, so all
  // viewers wait and the finding is surfaced org-wide for an administrator to route.
  const remediatorWaiting = pendingIndependentReview && !viewerIsReviewer;

  const decisionTargets = legalDecisionTargets(
    decisionState,
    opStatus
  )
    .filter((d) => !(riskAcceptanceActive && d === "accepted_risk" && d !== decisionState))
    // Under independent review, drop the CLOSE targets for a non-reviewer — keeping the
    // finding's current value so it still renders. Non-close transitions are untouched.
    .filter(
      (d) =>
        !(remediatorWaiting && (d === "resolved" || d === "accepted_risk") && d !== decisionState)
    );
  // Closure (Resolved) is only a legal move once operational_status is remediated
  // (or the risk is already accepted). When it is NOT yet offered we say so under
  // the control, so a first-time analyst reads its absence as sequencing — "this
  // decision comes later" — rather than a missing feature. The control itself stays
  // editable: recording Mitigating (a plan is accepted) is a legitimate early
  // decision that advances the lifecycle OUT of Assessed, so disabling it would
  // break the state machine, not clarify it.
  const closureAvailable = decisionTargets.includes("resolved");

  // #7 — a finding that exists was, at minimum, CREATED. When the audit feed carries
  // no explicit creation event, synthesize one from the finding's own authoritative
  // created_at — a real, persisted fact, not a fabricated event — so a brand-new
  // finding reads as "Finding created" on its Detected moment instead of the false
  // "No recorded activity". Appended last (oldest) and subject to the same de-dupe +
  // 20-row cap, so real audit events always take precedence.
  const activityRows: ActivityItem[] = context.activity.some((a) => a.event_type === "finding.created")
    ? context.activity
    : [
        ...context.activity,
        { event_type: "finding.created", created_at: finding.created_at, payload: null } as ActivityItem,
      ];

  // R-7 / R-19 / R-22: the operational + governance state as a single lifecycle
  // read, plus the next required action. Governance-pending means remediation is
  // DONE but no decision is recorded — the state the walkthrough found invisible.
  const life = lifecycleSummary(opStatus, decisionState);
  const governancePending =
    opStatus === "remediated" && decisionState !== "resolved" && decisionState !== "accepted_risk";
  // The Ready-to-Close queue asserts remediation is done; honor that framing on
  // arrival even if the client-side state snapshot hasn't re-derived yet (R-19).
  // Suppressed for a non-reviewer under independent review: they get the dedicated
  // waiting card below instead of a "record decision" call-to-action they cannot fulfil.
  const governanceHandoff =
    (governancePending || fromQueue === "ready_to_close") && !remediatorWaiting;
  // Provenance-only hand-off: we recognize the originating queue but there is no
  // governance CTA to make. A malformed/unknown `from` yields fromLabel === null →
  // no indicator. Rendered as a light breadcrumb, not a full card — navigation
  // history should never own a panel's worth of vertical space (#2).
  const provenanceOnly = !governanceHandoff && fromLabel !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <Link href="/findings" style={{ fontSize: 12, color: "#94a3b8" }}>← {homeLabel}</Link>

      {/* R-21 — compact lifecycle indicator: detected → assessed → remediation →
          governance → closed, derived from the two axes. */}
      <LifecycleIndicator operationalStatus={opStatus} decisionState={decisionState} />

      {/* Independent Governance Review waiting state (spec §6) — shown to a non-reviewer
          when remediation is complete but an independent reviewer must record the closure
          decision under separation of duties. It stands in for the governance hand-off CTA
          (suppressed above via governanceHandoff), and the close controls below are hidden
          for this viewer — so the dead 409 action is never offered. No error banner. */}
      {remediatorWaiting && (
        <IndependentReviewWaitingCard
          reviewer={reviewer}
          evidenceCount={context.evidence.length}
          fromLabel={fromLabel}
          returnHref={returnHref}
        />
      )}

      {/* R-19 / R-22 — governance hand-off. Remediation complete/undecided, or arrived
          from Ready to Close: a prominent CTA, because there is a real decision to make.
          Works from the URL alone, so a NEW TAB shows it. */}
      {governanceHandoff && (
        <div
          role="status"
          style={{
            background: "rgba(0,196,180,0.08)",
            border: "1px solid rgba(0,196,180,0.35)",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ color: "#00c4b4", fontWeight: 600, fontSize: 14 }}>
              Remediation complete. Governance decision required.
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>{life.nextAction}</div>
            {/* Provenance line — where the user came from, with a link back. */}
            {fromLabel && (
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                Opened from{" "}
                {returnHref ? (
                  <a href={returnHref} style={{ color: "#00c4b4", textDecoration: "underline" }}>
                    {fromLabel}
                  </a>
                ) : (
                  <span style={{ color: "#94a3b8" }}>{fromLabel}</span>
                )}
              </div>
            )}
          </div>
          {/* Opens the ACTUAL decision controls (options, consequences,
              rationale, confirm/cancel) — not an in-page scroll. */}
          <button
            type="button"
            onClick={() => setDecisionPanelOpen(true)}
            style={{
              background: "rgba(0,196,180,0.15)",
              border: "1px solid rgba(0,196,180,0.4)",
              color: "#00c4b4",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Record decision →
          </button>
        </div>
      )}

      {/* #2 — provenance-only hand-off. A light breadcrumb line, NOT a card: it states
          where the user came from and links back, without spending a panel on navigation
          history. fromLabel is non-null here (provenanceOnly). */}
      {provenanceOnly && (
        <div
          role="status"
          style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#64748b", flexWrap: "wrap" }}
        >
          <span>Opened from {fromLabel}</span>
          {returnHref && (
            <a href={returnHref} style={{ color: "#00c4b4", textDecoration: "none" }}>
              ← Back to {fromLabel}
            </a>
          )}
        </div>
      )}

      {/* The Governance Decision panel — modal decision controls. Cancel/backdrop
          records nothing; success refreshes the workspace with the new state. */}
      {decisionPanelOpen && (
        <GovernanceDecisionPanel
          findingId={finding.id}
          decisionState={decisionState}
          operationalStatus={opStatus}
          openActionCount={openActionCount}
          riskAcceptanceActive={riskAcceptanceActive}
          onClose={() => setDecisionPanelOpen(false)}
        />
      )}

      {/* P1 — the LOUD governance banner, above everything. When the workflow is on and a
          live acceptance exists, this states the governance status / owner / requester /
          approver / next action / dates at the top, so the state is never read off the
          Decision dropdown. Renders nothing when there is no live acceptance. */}
      {riskAcceptanceFeatureOn && riskAcceptances !== null && (
        <GovernanceBanner acceptances={riskAcceptances} currentUserId={currentUserId} />
      )}

      {/* ZONE A — Finding identity + decision. Visual hierarchy for a first-time
          analyst: (1) WHAT this is — title, severity, risk; (2) WHERE it is and the
          decision — the two orthogonal axes (DW-1: named + separated so governance is
          never inferred from an unlabeled control); (3) WHO owns it / WHEN it's due /
          HOW sure we are. The decision controls sit BELOW the identity so the eye reads
          the finding before it is asked to act on it. */}
      <div style={CARD} id="governance-decision">
        {/* (1) Identity — the first thing the eye should land on. */}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", margin: "0 0 8px" }}>{finding.title}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <Chip text={finding.severity} color={LEVEL_COLOR[String(finding.severity).toLowerCase()] ?? "#fca5a5"} />
          <Chip text={`Business impact: ${LEVEL_LABEL[topImpact]}`} color={LEVEL_COLOR[topImpact]} />
          <Chip text={`Risk ${context.risk.score}/100 (${context.risk.band})`} color="#93c5fd" />
          {finding.priority ? <Chip text={finding.priority} color="#fcd34d" /> : null}
        </div>
        {/* DW-4: risk-score explainability — the factors that produced the number,
            already computed by the engine (context.risk.rationale) and previously dropped. */}
        {context.risk.rationale.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#93c5fd" }}>
              Why {context.risk.score}/100? — how this score was computed
            </summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#94a3b8", fontSize: 12 }}>
              {context.risk.rationale.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </details>
        )}

        {/* (2) Decision + status — the two orthogonal axes, subordinate to identity. */}
        <div style={{ ...ZONE_A_DIVIDER, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* Governance Decision axis */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#c4b5fd", fontWeight: 600 }}>
                {GOVERNANCE_AXIS_LABEL}
              </span>
              <select
                value={context.finding.decision_state}
                disabled={pending}
                onChange={(e) => run(() => updateFindingDecisionStateAction(finding.id, e.target.value))}
                style={{ background: "#0f172a", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}
              >
                {/* Only transitions the lifecycle engine allows (spec §4) — never a
                    move the server would 409. When the signed acceptance workflow is
                    active, accepted_risk is owned by the panel below, not this dropdown. */}
                {decisionTargets.map((d) => (
                  <option key={d} value={d}>{DECISION_LABELS[d]}</option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: "#64748b", maxWidth: 240 }}>
                {DECISION_STATE_MEANINGS[context.finding.decision_state] ?? "The recorded risk-treatment decision."}
              </span>
              {/* #1 — "this decision comes later" without disabling the control: the
                  legal-moves filter already hides Resolved until remediation is done, so
                  say why, and its absence reads as sequencing rather than a missing feature. */}
              {!closureAvailable && decisionState !== "resolved" && (
                <span style={{ fontSize: 11, color: "#475569", maxWidth: 240 }}>
                  Closure (Resolved) unlocks once remediation is complete.
                </span>
              )}
            </div>

            {/* Operational Status axis — system-derived, read-only context (not an action). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#93c5fd", fontWeight: 600 }}>
                {OPERATIONAL_AXIS_LABEL}
              </span>
              <span>
                <OperationalStateBadge value={context.finding.operational_status} showAxis={false} />
              </span>
              <span style={{ fontSize: 11, color: "#64748b", maxWidth: 220 }}>
                Derived from linked remediation — you can&apos;t set it directly.
              </span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Governance actions</span>
            <div style={{ display: "flex", gap: 8 }}>
              {/* DW-3: framed as formal governance actions, not context-free peer buttons.
                  The legacy one-click Accept Risk exists ONLY when the signed workflow is
                  OFF (production); when on, accepted_risk is owned by propose → approve below.
                  Suppressed for a non-reviewer under independent review — accepting the risk
                  is a closure decision the close-time SoD gate would refuse them. */}
              {!riskAcceptanceFeatureOn && !remediatorWaiting && (
                <button
                  type="button"
                  disabled={pending}
                  title="Formally accept this risk — an audited governance decision that permits closure without full remediation."
                  onClick={() => run(() => updateFindingDecisionStateAction(finding.id, "accepted_risk"))}
                  style={{ background: "transparent", border: "1px solid #8b5cf6", color: "#c4b5fd", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
                >
                  Accept Risk
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                title="Escalate: raise this finding's priority to Immediate to pull it to the top of the queue for leadership attention."
                onClick={() => run(() => updateFindingPriorityAction(finding.id, "immediate"))}
                style={{ background: "#b91c1c", border: "1px solid #991b1b", color: "white", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
              >
                Escalate priority
              </button>
            </div>
          </div>
        </div>

        {actionError && (
          <p style={{ fontSize: 13, color: "#fca5a5", margin: "10px 0 0", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 6, padding: "6px 10px", background: "rgba(239,68,68,0.08)" }}>
            {actionError}{" "}
            {/* A refusal with no route to the blocking work leaves the customer stuck. */}
            {errorHref && (
              <button
                type="button"
                onClick={() => setTab("remediation")}
                style={{ background: "transparent", border: "none", padding: 0, color: "#93c5fd", textDecoration: "underline", cursor: "pointer", fontSize: 13 }}
              >
                View remediation
              </button>
            )}
          </p>
        )}

        {/* (3) Operational attributes — WHO owns it, WHEN it's due, HOW sure we are.
            #4: grouped into one labeled cluster so assignment and scanning are a single
            motion, not three facts scattered along an unlabeled line. */}
        <div style={{ ...ZONE_A_DIVIDER, display: "flex", gap: 24, flexWrap: "wrap" }}>
          {/* Finding owner — assignable in place. The engine has accepted owner_user_id
              on PATCH /api/findings/:id since 20260410; before this the only way to set it
              was a bulk op from the LIST, never from the finding you were looking at.
              DISTINCT from a remediation action's owner: this is who is accountable for the
              finding and its governance decision; each Action is assigned separately (see
              "Remediation owner" on the Remediation tab). Naming both "Owner" made an
              unassigned finding look like it contradicted an assigned action. */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150 }}
            title="Accountable for this finding and its governance decision. Remediation actions are assigned separately — see the Remediation owner on each action."
          >
            <span style={ATTR_LABEL}>Finding owner</span>
            {owners.length > 0 ? (
              <select
                value={context.owner?.id ?? ""}
                disabled={pending}
                onChange={(e) =>
                  run(() => assignFindingOwnerAction(finding.id, e.target.value || null))
                }
                style={{
                  background: "#0f1722",
                  border: "1px solid #1e293b",
                  color: "#e2e8f0",
                  fontSize: 13,
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              >
                <option value="">Unassigned</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <span style={ATTR_VALUE}>{context.owner?.email ?? "Unassigned"}</span>
            )}
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 3 }}
            title="The committed remediation due date (SLA) for this finding."
          >
            <span style={ATTR_LABEL}>SLA · Due date</span>
            <span style={ATTR_VALUE}>{fmt((finding as { due_date?: string | null }).due_date)}</span>
          </div>
          {/* DW-5: Confidence is otherwise a bare, undefined value. */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: 3 }}
            title="Confidence = how strongly the evidence supports this finding (higher = more certain). It discounts the risk score when low."
          >
            <span style={ATTR_LABEL}>Confidence</span>
            <span style={ATTR_VALUE}>
              {finding.confidence ?? "—"}
              <span style={{ color: "#475569" }}> ⓘ</span>
            </span>
          </div>
        </div>
      </div>

      {/* Risk acceptance — the signed governance lifecycle. P0 (2026-07-15): keyed off the
          FEATURE FLAG. Feature on + data → the panel owns accepted_risk. Feature on but data
          null (a transient fetch failure) → an explicit "unavailable" notice with a retry,
          NEVER a silent fall-back to the one-click side door. Feature off → nothing here
          (the legacy control lives in Zone A). */}
      {riskAcceptanceFeatureOn &&
        (riskAcceptances !== null ? (
          <div id="risk-acceptance">
            <RiskAcceptancePanel
              findingId={finding.id}
              acceptances={riskAcceptances}
              owners={owners}
              currentUserId={currentUserId}
            />
          </div>
        ) : (
          <div
            id="risk-acceptance"
            role="alert"
            style={{
              background: "rgba(148,163,184,0.08)",
              border: "1px solid rgba(148,163,184,0.35)",
              borderRadius: 10,
              padding: "14px 18px",
              fontSize: 13,
              color: "#cbd5e1",
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <span>
              The risk-acceptance workflow is temporarily unavailable, so its status can’t be
              shown right now. Accepting a risk is a governed decision — it is never a
              one-click status here. Reload to try again.
            </span>
            <button
              type="button"
              onClick={() => router.refresh()}
              style={{
                background: "transparent",
                border: "1px solid #475569",
                color: "#e2e8f0",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        ))}

      {/* ZONE B — What's changed. #6: when there is nothing to show, it collapses to a
          single muted line instead of a full padded card — an empty panel with an
          uppercase header taught the eye that this whole region is skippable. It earns
          its card only when there are actual changes to read. */}
      {context.whats_changed.changes.length > 0 ? (
        <div style={CARD}>
          <div style={H}>What&apos;s changed since your last review</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#e5e7eb", fontSize: 13 }}>
            {context.whats_changed.changes.map((c, i) => (
              <li key={i}>{c.label} <span style={{ color: "#64748b" }}>· {fmt(c.at)}</span></li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#64748b", padding: "0 4px" }}>
          <span style={{ color: "#94a3b8", fontWeight: 500 }}>What&apos;s changed:</span>{" "}
          {context.whats_changed.since
            ? "Nothing new since your last review."
            : "First review — no prior baseline yet."}
        </div>
      )}

      {/* ZONE C — Business impact */}
      <div style={CARD}>
        <div style={H}>Business impact</div>
        {/* Revenue and Customer rows removed — they were hardcoded "Not assessed"
            and could never read anything else. A row that can only ever say one
            thing is furniture, and it taught the eye to skip the whole panel. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* B-11: each dimension links through to the entities that make it real. */}
          <ImpactRow label="Operational" dim={bi.operational} entities={[...affected.controls, ...affected.ai_systems]} />
          <ImpactRow label="Regulatory" dim={bi.regulatory} entities={affected.obligations} />
          <ImpactRow label="Third-party" dim={bi.third_party} entities={affected.vendors} />
        </div>
      </div>

      {/* ZONE F — Risk Register (SL-RISK-LINK). Above the tabs, deliberately:
          "is the organization carrying this as a risk?" is a governance fact
          about the finding, and putting it inside a tab would mean activating
          this workspace REMOVED a capability the legacy layout shows
          unconditionally. */}
      {riskRegister && <div style={{ marginBottom: 20 }}>{riskRegister}</div>}

      {/* Tab strip — executive zones A–C stay above; the detail body splits into
          Overview (context) and Remediation (recommendation + actions). */}
      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid #1e293b" }}>
        {DECISION_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #93c5fd" : "2px solid transparent",
              color: tab === t.id ? "#f1f5f9" : "#94a3b8",
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: tab === t.id ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* REMEDIATION TAB — Zone F (recommendation & action; composed server-side) */}
      {tab === "remediation" && (
        <div style={CARD}>
          <div style={H}>Recommendation & action</div>
          {children}
        </div>
      )}

      {/* OVERVIEW TAB — Zones D, E, G (analyst context) */}
      {tab === "overview" && (
        <>
      {/* ZONE D — Affected context (analyst, collapsible) */}
      <details style={CARD} open={affectedTotal > 0 || (affected.candidates?.length ?? 0) > 0}>
        <summary style={{ ...H, cursor: "pointer", marginBottom: 0 }}>Affected context ({affectedTotal})</summary>
        <div style={{ marginTop: 12 }}>
          {/* C5 — canonical Enterprise Assets lead the affected context when the
              applicability read is live: the asset is the canonical thing that is
              exposed; vendor / AI system are two of its federated kinds, not the
              organizing principle. Rendered ONLY when the payload carries the
              bucket, so the dark surface is byte-identical. */}
          {affected.assets ? (
            <AffectedGroup label="Assets" items={affected.assets} resolution={affected.resolution?.assets} />
          ) : null}
          <AffectedGroup label="Vendors" items={affected.vendors} resolution={affected.resolution?.vendors} />
          <AffectedGroup label="AI systems" items={affected.ai_systems} resolution={affected.resolution?.ai_systems} />
          <AffectedGroup label="Controls" items={affected.controls} resolution={affected.resolution?.controls} />
          <AffectedGroup label="Obligations" items={affected.obligations} resolution={affected.resolution?.obligations} />
          <CandidateLinks
            candidates={affected.candidates ?? []}
            signalId={context.intelligence.signal_ids?.[0] ?? null}
          />
        </div>
      </details>

      {/* ZONE E — Evidence & Intelligence (analyst, collapsible) */}
      <details style={CARD} open={context.intelligence.events.length > 0 || context.evidence.length > 0}>
        <summary style={{ ...H, cursor: "pointer", marginBottom: 0 }}>Evidence & intelligence</summary>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Supporting intelligence events</div>
            {context.intelligence.events.length === 0 ? (
              <span style={{ fontSize: 12, color: "#475569" }}>{intelligenceEmptyCopy(finding.source_type)}</span>
            ) : (
              context.intelligence.events.map((e, i) => {
                const eventId = findingEventId(e);
                const label = (
                  <>
                    {String(e.title ?? "External intelligence signal")}
                    {e.severity ? <span style={{ color: "#64748b" }}> · {String(e.severity)}</span> : null}
                    {e.affected_cve ? <span style={{ color: "#64748b" }}> · {String(e.affected_cve)}</span> : null}
                  </>
                );
                // Drill through to the canonical event when it has an id; carry
                // the finding so the drill-through can back-link and fall back to
                // this finding's context. No id → plain text (byte-identical).
                return eventId ? (
                  <div key={i} style={{ fontSize: 13 }}>
                    <Link href={intelligenceEventHref(eventId, finding.id)} style={{ color: "#93c5fd" }}>
                      {label}
                    </Link>
                  </div>
                ) : (
                  <div key={i} style={{ fontSize: 13, color: "#e5e7eb" }}>
                    {label}
                  </div>
                );
              })
            )}
          </div>
          {context.intelligence.sources.length > 0 && (
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              Sources: {context.intelligence.sources.map((s) => String(s.source)).join(", ")}
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Evidence ({context.evidence.length})</div>
            {context.evidence.length === 0 ? (
              // Overview reports evidence; the Remediation tab is where it is
              // attached. Without this pointer the empty state is a dead end —
              // and for a gate-enforcing org it is the thing blocking remediation.
              <span style={{ fontSize: 12, color: "#475569" }}>
                No evidence attached — add it in the{" "}
                <button
                  type="button"
                  onClick={() => setTab("remediation")}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    fontSize: 12,
                    color: "#93c5fd",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Remediation tab
                </button>
              </span>
            ) : (
              context.evidence.map((ev, i) => {
                const ref = ev.external_ref == null ? null : String(ev.external_ref);
                const href = evidenceRefHref(ref);
                const type = ev.evidence_type ? String(ev.evidence_type).replace(/_/g, " ") : null;
                const when = ev.collected_at ?? ev.created_at;
                return (
                  <div key={i} style={{ fontSize: 13, color: "#e5e7eb", marginBottom: 4 }}>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd" }}>
                        {String(ev.title)} ↗
                      </a>
                    ) : (
                      <span>{String(ev.title)}</span>
                    )}
                    <span style={{ color: "#64748b", fontSize: 12 }}>
                      {type ? ` · ${type}` : ""}
                      {when ? ` · ${fmt(String(when))}` : ""}
                    </span>
                    {/* A non-URL reference is still shown so it is copyable — never a dead link. */}
                    {ref && !href && (
                      <div style={{ fontSize: 11, color: "#64748b" }}>Ref: {ref}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </details>

      {/* ZONE G — Related findings + activity */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ ...CARD, flex: 1, minWidth: 260 }}>
          <div style={H}>Related findings</div>
          {context.related_findings.length === 0 ? (
            <span style={{ fontSize: 12, color: "#475569" }}>
              Nothing else is about this vulnerability, asset or assessment
            </span>
          ) : (
            context.related_findings.map((r) => (
              <div key={r.id} style={{ fontSize: 13, marginBottom: 4 }}>
                <Link href={`/findings/${r.id}`} style={{ color: "#93c5fd" }}>{r.title}</Link>
                <span style={{ color: "#64748b" }}> · {r.severity}</span>
                {/* WHY it is related. Without this the list is an assertion the
                    customer has to take on trust; with it, it is evidence. */}
                {r.relation && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                    {RELATION_LABEL[r.relation] ?? r.relation}
                  </div>
                )}
              </div>
            ))
          )}

          {/* TIER 5 — vendor is SUPPORTING CONTEXT. One navigational line per
              vendor, never a list of findings. An org with 1000+ Microsoft
              findings must not have its Decision Workspace turn into a vendor
              browser; the work lives with the assets, not the supplier. */}
          {(context.related_context?.same_vendor ?? []).map((v) => (
            <div
              key={v.vendor_id}
              style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <Link href={`/vendors/${v.vendor_id}`} style={{ fontSize: 12, color: "#93c5fd" }}>
                {v.finding_count} other finding{v.finding_count === 1 ? "" : "s"} also affect{" "}
                {v.vendor_name} →
              </Link>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                Same vendor — supporting context, not the same problem
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...CARD, flex: 1, minWidth: 260 }}>
          <div style={H}>Activity</div>
          {activityRows.length === 0 ? (
            <span style={{ fontSize: 12, color: "#475569" }}>No recorded activity</span>
          ) : (
            // Audit-grade entries, newest-first (the resolver orders
            // created_at DESC, id DESC): exact UTC timestamp, WHO acted, the
            // specific transition, WHICH remediation action, and — for a
            // block/unblock — the preserved blocker metadata. Deduped against
            // accidental double-writes, never collapsing distinct events. Includes
            // the synthesized "Finding created" baseline (#7) when the feed carries
            // no explicit creation event.
            dedupeActivity(activityRows)
              .slice(0, 20)
              .map((a, i) => {
                const identity = activityActionIdentity(a);
                const transition = activityTransition(a);
                const blocker = activityBlocker(a);
                const completionNote = activityCompletionNote(a);
                return (
                  <div
                    key={`${a.event_type}:${a.resource_id ?? ""}:${a.created_at}:${i}`}
                    style={{
                      fontSize: 12,
                      color: "#cbd5e1",
                      marginBottom: 8,
                      paddingBottom: 8,
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div>
                      <span style={{ color: "#64748b" }} title={a.created_at}>
                        {fmtActivityTimestamp(a.created_at)}
                      </span>{" "}
                      · <span style={{ color: "#e2e8f0" }}>{activityLabel(a.event_type, a.payload)}</span>
                      {transition && <span style={{ color: "#94a3b8" }}> · {transition}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
                      {activityActor(a)}
                      {identity && (
                        <>
                          {" · "}
                          <span style={{ color: "#cbd5e1" }}>{identity}</span>
                        </>
                      )}
                    </div>
                    {blocker && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          marginTop: 4,
                          padding: "4px 8px",
                          borderRadius: 4,
                          background: "rgba(239,68,68,0.06)",
                          border: "1px solid rgba(239,68,68,0.2)",
                        }}
                      >
                        {blocker.reason && (
                          <div>
                            <span style={{ color: "#fca5a5" }}>Blocker:</span> {blocker.reason}
                          </div>
                        )}
                        {blocker.dependency && <div>Depends on: {blocker.dependency}</div>}
                        {blocker.owner && <div>Blocker owner: {blocker.owner}</div>}
                        {blocker.expected && <div>Expected unblock: {blocker.expected}</div>}
                      </div>
                    )}
                    {completionNote && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          marginTop: 4,
                          padding: "4px 8px",
                          borderRadius: 4,
                          background: "rgba(34,197,94,0.06)",
                          border: "1px solid rgba(34,197,94,0.2)",
                        }}
                      >
                        <span style={{ color: "#86efac" }}>Completion note:</span> {completionNote}
                      </div>
                    )}
                  </div>
                );
              })
          )}
        </div>
      </div>
        </>
      )}

      {/* Mark reviewed — a per-USER acknowledgement, not a lifecycle change.
          Its effect is explicit here so it can't read as a status/decision action:
          it timestamps YOUR review and resets the "What's changed since your last
          review" baseline (Zone B) — nothing else. Now also written to the audit
          trail server-side (finding.reviewed). */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={pending}
          title="Records that you reviewed this finding and resets your 'What's changed since your last review' baseline. Does not change the finding's status or decision."
          onClick={() => run(() => markFindingReviewedAction(finding.id))}
          style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
        >
          Mark reviewed by me
        </button>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {context.whats_changed.since
            ? `You last reviewed this on ${fmt(context.whats_changed.since)}. `
            : "You haven't marked this reviewed yet. "}
          This is a personal bookmark: it clears your “What’s changed since your last review”
          list above. It does not change the governance decision, operational status, or any queue.
        </span>
      </div>
    </div>
  );
}
