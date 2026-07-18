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
  updateFindingStatusAction,
  updateFindingPriorityAction,
  updateFindingDecisionStateAction,
  markFindingReviewedAction,
  assignFindingOwnerAction,
} from "./actions";

// Canonical governance labels (shared module) — the Decision Workspace was one of
// the screens that re-declared these; it now imports the single source of truth.
const DECISION_LABELS = DECISION_STATE_LABELS;
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
  accepted: "Accepted",
};
const STATUS_ORDER = ["open", "in_progress", "closed", "accepted"];
/** Mirrors the engine's sqlActionActive(): status IN ('open','in_progress','blocked'). */
const ACTION_ACTIVE = new Set(["open", "in_progress", "blocked"]);
/** The legacy terminals — the writes the closure gate refuses when remediation is open. */
const CLOSING_STATUSES = new Set(["closed", "accepted"]);

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
};

const ENTITY_TYPE_LABEL: Record<string, string> = {
  vendor: "Vendor",
  ai_system: "AI System",
  control: "Control",
  obligation: "Obligation",
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

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 20,
};
const H: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "#64748b", marginBottom: 10 };

export function DecisionWorkspace({
  finding,
  context,
  owners = [],
  riskAcceptances = null,
  riskAcceptanceFeatureOn = false,
  currentUserId = null,
  openActionCount = 0,
  children,
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
  /** Non-terminal remediation Actions on this finding — see closureBlocked below. */
  openActionCount?: number;
  // The recommendation + remediation-actions block (Zone F) is composed by the
  // server page (reusing AddActionForm/ActionCard) and passed in as children.
  children: React.ReactNode;
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

  /**
   * Blocking remediation this page ALREADY knows about — the Remediation tab renders these
   * very Actions, so the count is passed down rather than re-fetched. Used to relabel the
   * closing controls up front instead of inviting a click the server will refuse.
   * Courtesy, not security: the engine still enforces.
   */
  const closureBlocked = openActionCount > 0;

  const affected = context.affected;
  const affectedTotal =
    affected.vendors.length + affected.ai_systems.length + affected.controls.length + affected.obligations.length;
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
  const decisionTargets = legalDecisionTargets(
    decisionState,
    context.finding.operational_status ?? null
  ).filter((d) => !(riskAcceptanceActive && d === "accepted_risk" && d !== decisionState));

  // R-7 / R-19 / R-22: the operational + governance state as a single lifecycle
  // read, plus the next required action. Governance-pending means remediation is
  // DONE but no decision is recorded — the state the walkthrough found invisible.
  const opStatus = context.finding.operational_status ?? null;
  const life = lifecycleSummary(opStatus, decisionState);
  const governancePending =
    opStatus === "remediated" && decisionState !== "resolved" && decisionState !== "accepted_risk";
  // The Ready-to-Close queue asserts remediation is done; honor that framing on
  // arrival even if the client-side state snapshot hasn't re-derived yet (R-19).
  const governanceHandoff = governancePending || fromQueue === "ready_to_close";
  // Show the banner whenever remediation-governance is pending OR we recognize the
  // originating queue (so a new tab always states its provenance and offers a way
  // back). A malformed/unknown `from` yields fromLabel === null → no banner.
  const showHandoff = governanceHandoff || fromLabel !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <Link href="/findings" style={{ fontSize: 12, color: "#94a3b8" }}>← Findings</Link>

      {/* R-21 — compact lifecycle indicator: detected → assessed → remediation →
          governance → closed, derived from the two axes. */}
      <LifecycleIndicator operationalStatus={opStatus} decisionState={decisionState} />

      {/* R-19 / R-20 / R-22 — originating-queue hand-off. Two shapes share one banner:
          (a) governance hand-off — remediation complete/undecided, or arrived from
              Ready to Close: state it plainly, make the governance decision primary;
          (b) provenance hand-off — arrived from any other recognized queue: name the
              queue and offer an exact link back.
          Both work from the URL alone, so a NEW TAB shows the right banner. */}
      {showHandoff && (
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
          {governanceHandoff ? (
            <>
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
              <a
                href="#governance-decision"
                style={{
                  background: "rgba(0,196,180,0.15)",
                  border: "1px solid rgba(0,196,180,0.4)",
                  color: "#00c4b4",
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Record decision →
              </a>
            </>
          ) : (
            // Provenance-only hand-off: fromLabel is non-null here (showHandoff true,
            // not a governance hand-off).
            <>
              <div>
                <div style={{ color: "#00c4b4", fontWeight: 600, fontSize: 14 }}>
                  Opened from {fromLabel}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
                  You’re reviewing this finding from your {fromLabel} queue.
                </div>
              </div>
              {returnHref && (
                <a
                  href={returnHref}
                  style={{
                    background: "rgba(0,196,180,0.15)",
                    border: "1px solid rgba(0,196,180,0.4)",
                    color: "#00c4b4",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  ← Back to {fromLabel}
                </a>
              )}
            </>
          )}
        </div>
      )}

      {/* P1 — the LOUD governance banner, above everything. When the workflow is on and a
          live acceptance exists, this states the governance status / owner / requester /
          approver / next action / dates at the top, so the state is never read off the
          Decision dropdown. Renders nothing when there is no live acceptance. */}
      {riskAcceptanceFeatureOn && riskAcceptances !== null && (
        <GovernanceBanner acceptances={riskAcceptances} currentUserId={currentUserId} />
      )}

      {/* ZONE A — Decision header. DW-1: the two orthogonal axes are named and
          separated — Governance Decision (human) vs Operational Status (system-
          derived) — so the user never infers governance from an unlabeled control. */}
      <div style={CARD} id="governance-decision">
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
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
            </div>

            {/* Operational Status axis — system-derived, read-only. */}
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

            {/* Legacy lifecycle status — being superseded by the two axes above;
                kept editable so no behavior changes, but clearly subordinate. */}
            <details style={{ alignSelf: "center" }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: "#64748b" }}>Legacy status</summary>
              <select
                value={finding.status}
                disabled={pending}
                onChange={(e) => run(() => updateFindingStatusAction(finding.id, e.target.value))}
                style={{ background: "#0f172a", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", fontSize: 13, marginTop: 4 }}
              >
                {/* Relabel + disable the CLOSING options when this page can already see open
                    remediation. Server-side enforcement is unchanged and remains the authority. */}
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s} disabled={closureBlocked && CLOSING_STATUSES.has(s)}>
                    {closureBlocked && CLOSING_STATUSES.has(s)
                      ? `${STATUS_LABELS[s]} (remediation open)`
                      : STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </details>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Governance actions</span>
            <div style={{ display: "flex", gap: 8 }}>
              {/* DW-3: framed as formal governance actions, not context-free peer buttons.
                  The legacy one-click Accept Risk exists ONLY when the signed workflow is
                  OFF (production); when on, accepted_risk is owned by propose → approve below. */}
              {!riskAcceptanceFeatureOn && (
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

        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", margin: "14px 0 6px" }}>{finding.title}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <Chip text={finding.severity} color={LEVEL_COLOR[String(finding.severity).toLowerCase()] ?? "#fca5a5"} />
          <Chip text={`Business impact: ${LEVEL_LABEL[topImpact]}`} color={LEVEL_COLOR[topImpact]} />
          <Chip text={`Risk ${context.risk.score}/100 (${context.risk.band})`} color="#93c5fd" />
          {finding.priority ? <Chip text={finding.priority} color="#fcd34d" /> : null}
        </div>
        {/* DW-4: risk-score explainability — the factors that produced the number,
            already computed by the engine (context.risk.rationale) and previously dropped. */}
        {context.risk.rationale.length > 0 && (
          <details style={{ marginBottom: 8 }}>
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
        <div style={{ fontSize: 13, color: "#94a3b8", display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Ownership was read-only text. The engine has accepted owner_user_id on
              PATCH /api/findings/:id since 20260410; the only way to set it was a
              bulk op from the LIST that assigned to yourself. From the finding you
              were actually looking at — the one place you have the context to decide
              who should own it — you could not. */}
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            Owner:
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
                  fontSize: 12,
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
              <span>{context.owner?.email ?? "Unassigned"}</span>
            )}
          </span>
          <span title="The committed remediation due date (SLA) for this finding.">
            SLA: {fmt((finding as { due_date?: string | null }).due_date)}
          </span>
          {/* DW-5: Confidence is otherwise a bare, undefined value. */}
          <span title="Confidence = how strongly the evidence supports this finding (higher = more certain). It discounts the risk score when low.">
            Confidence: {finding.confidence ?? "—"}
            <span style={{ color: "#475569" }}> ⓘ</span>
          </span>
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

      {/* ZONE B — What's changed */}
      <div style={CARD}>
        <div style={H}>What&apos;s changed since your last review</div>
        {context.whats_changed.changes.length === 0 ? (
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            {context.whats_changed.since ? "No changes since your last review." : "First review — no prior baseline."}
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, color: "#e5e7eb", fontSize: 13 }}>
            {context.whats_changed.changes.map((c, i) => (
              <li key={i}>{c.label} <span style={{ color: "#64748b" }}>· {fmt(c.at)}</span></li>
            ))}
          </ul>
        )}
      </div>

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
          {context.activity.length === 0 ? (
            <span style={{ fontSize: 12, color: "#475569" }}>No recorded activity</span>
          ) : (
            // DW-9: show meaningful workflow transitions with readable labels
            // (assignment, remediation, evidence, decisions, closure, reopen),
            // not raw event_type strings, and more than the prior 8.
            context.activity.slice(0, 20).map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 2 }}>
                <span style={{ color: "#64748b" }}>{fmt(a.created_at)}</span> · {activityLabel(a.event_type, a.payload)}
              </div>
            ))
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
