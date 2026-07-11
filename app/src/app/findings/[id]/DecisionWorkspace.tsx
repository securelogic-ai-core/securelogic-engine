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
import { useRouter } from "next/navigation";
import type {
  Finding,
  Action,
  FindingContext,
  FindingImpactDimension,
  AffectedResolution,
  FindingCandidateEntity,
} from "@/lib/api";
import { intelligenceEventHref, findingEventId } from "@/lib/intelligenceLinks";
import { DECISION_TABS, DEFAULT_DECISION_TAB, type DecisionTab } from "./decisionTabs";
import { legalDecisionTargets } from "./decisionTransitions";
import { intelligenceEmptyCopy } from "./findingSourceCopy";
import { topBusinessImpact } from "./businessImpact";
import {
  updateFindingStatusAction,
  updateFindingPriorityAction,
  updateFindingDecisionStateAction,
  markFindingReviewedAction,
} from "./actions";

const DECISION_LABELS: Record<string, string> = {
  needs_review: "Needs Review",
  accepted_risk: "Accepted Risk",
  mitigating: "Mitigating",
  resolved: "Resolved",
};
const OPERATIONAL_LABELS: Record<string, string> = {
  open: "Work not started",
  in_progress: "Work in progress",
  remediated: "Remediation complete",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
  accepted: "Accepted",
};
const STATUS_ORDER = ["open", "in_progress", "closed", "accepted"];

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

function ImpactRow({ label, dim }: { label: string; dim: FindingImpactDimension }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 96, fontSize: 12, color: "#94a3b8" }}>{label}</span>
      <Chip text={LEVEL_LABEL[dim.level] ?? dim.level} color={LEVEL_COLOR[dim.level] ?? "#94a3b8"} />
      <span style={{ fontSize: 12, color: "#64748b" }}>{dim.note}</span>
    </div>
  );
}

const ENTITY_ROUTE: Record<string, string> = {
  vendor: "/vendors",
  ai_system: "/ai-systems",
  control: "/controls",
  obligation: "/obligations",
};

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

function CandidateLinks({ candidates }: { candidates: FindingCandidateEntity[] }) {
  if (candidates.length === 0) return null;
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
        Suggested links pending review ({candidates.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {candidates.map((c) => (
          <span key={`${c.type}:${c.id}`} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#cbd5e1" }}>{c.name}</span>
            <Chip text="Needs review" color="#fcd34d" />
          </span>
        ))}
        <Link href="/queue" style={{ fontSize: 12, color: "#93c5fd" }}>
          Review in queue →
        </Link>
      </div>
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
  children,
}: {
  finding: Finding;
  context: FindingContext;
  // The recommendation + remediation-actions block (Zone F) is composed by the
  // server page (reusing AddActionForm/ActionCard) and passed in as children.
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<DecisionTab>(DEFAULT_DECISION_TAB);
  // Guarded transitions can be legitimately refused (close guard, evidence
  // gate, separation of duties) — show the refusal instead of a silent no-op.
  const [actionError, setActionError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r?.error) {
        setActionError(null);
        router.refresh();
      } else {
        setActionError(r.error);
      }
    });

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      <Link href="/findings" style={{ fontSize: 12, color: "#94a3b8" }}>← Findings</Link>

      {/* ZONE A — Decision header */}
      <div style={CARD}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Decision</span>
            <select
              value={context.finding.decision_state}
              disabled={pending}
              onChange={(e) => run(() => updateFindingDecisionStateAction(finding.id, e.target.value))}
              style={{ background: "#0f172a", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}
            >
              {/* Only transitions the lifecycle engine allows (spec §4) — the
                  dropdown never offers a move the server would 409. Closing
                  requires derived remediation or an accepted-risk override. */}
              {legalDecisionTargets(
                context.finding.decision_state,
                context.finding.operational_status ?? null
              ).map((d) => (
                <option key={d} value={d}>{DECISION_LABELS[d]}</option>
              ))}
            </select>
            {context.finding.operational_status ? (
              <Chip
                text={OPERATIONAL_LABELS[context.finding.operational_status] ?? context.finding.operational_status}
                color={context.finding.operational_status === "remediated" ? "#86efac" : "#94a3b8"}
              />
            ) : null}
            <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>Status</span>
            <select
              value={finding.status}
              disabled={pending}
              onChange={(e) => run(() => updateFindingStatusAction(finding.id, e.target.value))}
              style={{ background: "#0f172a", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => updateFindingDecisionStateAction(finding.id, "accepted_risk"))}
              style={{ background: "transparent", border: "1px solid #475569", color: "#cbd5e1", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
            >
              Accept Risk
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => updateFindingPriorityAction(finding.id, "immediate"))}
              style={{ background: "#b91c1c", border: "1px solid #991b1b", color: "white", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
            >
              Escalate
            </button>
          </div>
        </div>

        {actionError && (
          <p style={{ fontSize: 13, color: "#fca5a5", margin: "10px 0 0", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 6, padding: "6px 10px", background: "rgba(239,68,68,0.08)" }}>
            {actionError}
          </p>
        )}

        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", margin: "14px 0 6px" }}>{finding.title}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <Chip text={finding.severity} color={LEVEL_COLOR[String(finding.severity).toLowerCase()] ?? "#fca5a5"} />
          <Chip text={`Business impact: ${LEVEL_LABEL[topImpact]}`} color={LEVEL_COLOR[topImpact]} />
          <Chip text={`Risk ${context.risk.score}/100 (${context.risk.band})`} color="#93c5fd" />
          {finding.priority ? <Chip text={finding.priority} color="#fcd34d" /> : null}
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span>Owner: {context.owner?.email ?? "Unassigned"}</span>
          <span>SLA: {fmt((finding as { due_date?: string | null }).due_date)}</span>
          <span>Confidence: {finding.confidence ?? "—"}</span>
        </div>
      </div>

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
          <ImpactRow label="Operational" dim={bi.operational} />
          <ImpactRow label="Regulatory" dim={bi.regulatory} />
          <ImpactRow label="Third-party" dim={bi.third_party} />
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
          <CandidateLinks candidates={affected.candidates ?? []} />
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
              <span style={{ fontSize: 12, color: "#475569" }}>No evidence attached</span>
            ) : (
              context.evidence.map((ev, i) => (
                <div key={i} style={{ fontSize: 13, color: "#e5e7eb" }}>{String(ev.title)}</div>
              ))
            )}
          </div>
        </div>
      </details>

      {/* ZONE G — Related findings + activity */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ ...CARD, flex: 1, minWidth: 260 }}>
          <div style={H}>Related findings</div>
          {context.related_findings.length === 0 ? (
            <span style={{ fontSize: 12, color: "#475569" }}>None</span>
          ) : (
            context.related_findings.map((r) => (
              <div key={r.id} style={{ fontSize: 13 }}>
                <Link href={`/findings/${r.id}`} style={{ color: "#93c5fd" }}>{r.title}</Link>
                <span style={{ color: "#64748b" }}> · {r.severity}</span>
              </div>
            ))
          )}
        </div>
        <div style={{ ...CARD, flex: 1, minWidth: 260 }}>
          <div style={H}>Activity</div>
          {context.activity.length === 0 ? (
            <span style={{ fontSize: 12, color: "#475569" }}>No recorded activity</span>
          ) : (
            context.activity.slice(0, 8).map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: "#cbd5e1" }}>
                {fmt(a.created_at)} · {a.event_type.replace(/^finding\./, "")}
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
          Mark reviewed
        </button>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {context.whats_changed.since
            ? `You last reviewed this on ${fmt(context.whats_changed.since)}. `
            : "You haven't marked this reviewed yet. "}
          Resets your “what’s changed” baseline — it doesn’t change status or decision.
        </span>
      </div>
    </div>
  );
}
