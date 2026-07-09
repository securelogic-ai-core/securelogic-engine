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

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Finding, Action, FindingContext, FindingImpactDimension } from "@/lib/api";
import { intelligenceEventHref, findingEventId } from "@/lib/intelligenceLinks";
import {
  updateFindingStatusAction,
  updateFindingPriorityAction,
  updateFindingDecisionStateAction,
  markFindingReviewedAction,
} from "./actions";

const DECISION_LABELS: Record<string, string> = {
  needs_review: "Needs Review",
  accepted_risk: "Accepted Risk",
  in_progress: "In Progress",
  mitigating: "Mitigating",
  resolved: "Resolved",
};
const DECISION_ORDER = ["needs_review", "accepted_risk", "in_progress", "mitigating", "resolved"];
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

function AffectedGroup({ label, items }: { label: string; items: FindingContext["affected"]["vendors"]; }) {
  const route: Record<string, string> = {
    vendor: "/vendors",
    ai_system: "/ai-systems",
    control: "/controls",
    obligation: "/obligations",
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>
        {label} ({items.length})
      </div>
      {items.length === 0 ? (
        <span style={{ fontSize: 12, color: "#475569" }}>None</span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {items.map((e) => (
            <Link key={e.id} href={`${route[e.type] ?? "#"}/${e.id}`} style={{ fontSize: 13, color: "#93c5fd" }}>
              {e.name}
            </Link>
          ))}
        </div>
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
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r?.error) router.refresh();
    });

  const affected = context.affected;
  const affectedTotal =
    affected.vendors.length + affected.ai_systems.length + affected.controls.length + affected.obligations.length;
  const bi = context.business_impact;
  const topImpact = [bi.third_party, bi.regulatory, bi.operational]
    .map((d) => d.level)
    .find((l) => l === "high" || l === "medium") ?? "low";

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
              {DECISION_ORDER.map((d) => (
                <option key={d} value={d}>{DECISION_LABELS[d]}</option>
              ))}
            </select>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ImpactRow label="Revenue" dim={bi.revenue} />
          <ImpactRow label="Operational" dim={bi.operational} />
          <ImpactRow label="Regulatory" dim={bi.regulatory} />
          <ImpactRow label="Customer" dim={bi.customer} />
          <ImpactRow label="Third-party" dim={bi.third_party} />
        </div>
      </div>

      {/* ZONE F — Recommendation & action (always visible; composed server-side) */}
      <div style={CARD}>
        <div style={H}>Recommendation & action</div>
        {children}
      </div>

      {/* ZONE D — Affected context (analyst, collapsible) */}
      <details style={CARD} open={affectedTotal > 0}>
        <summary style={{ ...H, cursor: "pointer", marginBottom: 0 }}>Affected context ({affectedTotal})</summary>
        <div style={{ marginTop: 12 }}>
          <AffectedGroup label="Vendors" items={affected.vendors} />
          <AffectedGroup label="AI systems" items={affected.ai_systems} />
          <AffectedGroup label="Controls" items={affected.controls} />
          <AffectedGroup label="Obligations" items={affected.obligations} />
        </div>
      </details>

      {/* ZONE E — Evidence & Intelligence (analyst, collapsible) */}
      <details style={CARD} open={context.intelligence.events.length > 0 || context.evidence.length > 0}>
        <summary style={{ ...H, cursor: "pointer", marginBottom: 0 }}>Evidence & intelligence</summary>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Supporting intelligence events</div>
            {context.intelligence.events.length === 0 ? (
              <span style={{ fontSize: 12, color: "#475569" }}>No linked intelligence event</span>
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

      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => markFindingReviewedAction(finding.id))}
          style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
        >
          Mark reviewed
        </button>
      </div>
    </div>
  );
}
