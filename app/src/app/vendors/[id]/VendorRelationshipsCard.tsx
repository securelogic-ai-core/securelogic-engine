"use client";

/**
 * VendorRelationshipsCard — Vendor Onboarding 2.0.
 *
 * What the customer buys from this vendor, one row per relationship, each
 * carrying the DERIVED classification: Criticality (business dependency),
 * Inherent risk (exposure before controls) and the Assessment tier as their
 * joint function. The customer is never asked to choose a classification —
 * they answer facts, and every rating shows the basis that produced it.
 *
 * Two product rules are visible rather than hidden:
 *   - a relationship without factual intake is INTAKE REQUIRED. It renders as
 *     ignorance — no score, no band, no tier — never as a zero;
 *   - customer policy may raise the tier above SecureLogic's calculated
 *     minimum, never lower it, and a refused request is shown as refused.
 * Both are enforced by the engine; this component reports what it says.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VendorRelationship, AssessmentTierValue, RelationshipIntakeInput, ClassificationBasis, TierBasis } from "@/lib/api";
import { ASSESSMENT_TIER_VALUES } from "@/lib/api";
import { DEPENDENCY_FIELDS, EXPOSURE_FIELDS, TIER_LABELS, type IntakeFieldDef } from "@/lib/vendorRelationshipIntake";
import { addVendorRelationship, recordRelationshipIntake, setRelationshipPolicy, openAssessmentForRelationship } from "@/app/actions/vendorRelationships";
import { TRANSPORT_FAILURE } from "./VendorContactsCard";
import ClassificationBasisPanel from "@/components/vendorRisk/ClassificationBasisPanel";

const card: React.CSSProperties = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 };
const input = (): React.CSSProperties => ({ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#0b1220", color: "#e2e8f0", fontSize: 12 });
const BAND_COLOR: Record<string, string> = { Critical: "#fca5a5", High: "#fdba74", Moderate: "#fde68a", Low: "#86efac" };
const btn = (accent = false): React.CSSProperties => ({ fontSize: 11, color: accent ? "#93c5fd" : "#94a3b8", background: accent ? "rgba(30,58,138,0.25)" : "transparent", border: "1px solid #334155", borderRadius: 6, padding: "3px 10px", cursor: "pointer" });

function Band({ label, band, score }: { label: string; band: string | null; score: number | null }): JSX.Element {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 13, color: band ? BAND_COLOR[band] ?? "#e2e8f0" : "#475569" }}>
        {band ?? "—"}{score !== null && band ? <span style={{ color: "#64748b", fontSize: 11 }}> · {score}</span> : null}
      </div>
    </div>
  );
}

function Field({ def, value, onChange, disabled }: { def: IntakeFieldDef; value: string; onChange: (v: string) => void; disabled: boolean }): JSX.Element {
  return (
    <label style={{ display: "grid", gap: 3 }}>
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{def.label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={input()} aria-label={def.label}>
        <option value="">Select…</option>
        {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span style={{ fontSize: 10, color: "#64748b" }}>{def.help}</span>
    </label>
  );
}

/**
 * Mirrors the engine's re-intake gate in `vendorRelationships.ts` (a trimmed
 * `change_reason` shorter than this is refused with `change_reason_required`).
 * Kept client-side only to disable the button rather than let the round trip
 * fail; the engine remains the authority.
 */
const REASON_MIN = 10;

function IntakeForm({ vendorId, relationship, onDone }: { vendorId: string; relationship: VendorRelationship; onDone: (msg: string) => void }): JSX.Element {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [breach, setBreach] = useState(false);
  // WA-2: a re-intake must say what changed. The first intake is the baseline
  // and is exempt, so the field only appears once a classification exists.
  const isReintake = relationship.classification_state === "classified";
  const [reason, setReason] = useState("");
  const reasonOk = !isReintake || reason.trim().length >= REASON_MIN;
  const all = [...DEPENDENCY_FIELDS, ...EXPOSURE_FIELDS];
  const factsComplete = all.every((f) => (v[f.name] ?? "") !== "");
  const complete = factsComplete && reasonOk;
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val, ...(k === "ai_involvement" && val === "none" ? { ai_autonomy: "none" } : {}) }));

  return (
    <div style={{ marginTop: 10, padding: 12, border: "1px dashed #334155", borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 6 }}>Factual intake — {relationship.name}</div>
      <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 10px" }}>
        Answer the facts; SecureLogic derives the classification. Nothing is scored until every question is answered.
      </p>
      <div style={{ fontSize: 11, color: "#94a3b8", margin: "6px 0" }}>Business dependency → Criticality</div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        {DEPENDENCY_FIELDS.map((f) => <Field key={f.name} def={f} value={v[f.name] ?? ""} onChange={(x) => set(f.name, x)} disabled={pending} />)}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", margin: "12px 0 6px" }}>Exposure → Inherent risk</div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        {EXPOSURE_FIELDS.map((f) => (
          <Field key={f.name} def={f} value={v[f.name] ?? ""} onChange={(x) => set(f.name, x)} disabled={pending || (f.name === "ai_autonomy" && (v.ai_involvement ?? "") === "none")} />
        ))}
      </div>
      <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" checked={breach} onChange={(e) => setBreach(e.target.checked)} disabled={pending} />
        An active obligation in scope carries a breach-notification duty
      </label>
      {isReintake && (
        <label style={{ display: "grid", gap: 3, marginTop: 10 }}>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>What changed about this relationship?</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            rows={2}
            aria-label="What changed about this relationship?"
            style={{ ...input(), resize: "vertical", fontFamily: "inherit" }}
          />
          <span style={{ fontSize: 10, color: "#64748b" }}>
            Re-recording the intake re-derives Criticality, Inherent risk and the Assessment tier. The reason is kept
            with the new facts, and the previous version stays in the history.
          </span>
        </label>
      )}
      <button
        type="button"
        disabled={pending || !complete}
        style={{ ...btn(true), marginTop: 10, padding: "6px 12px", fontSize: 12 }}
        onClick={() => {
          setError(null);
          start(async () => {
            // Same rule as the contacts card: a rejected action call (the POST
            // never reached the app) is reported HERE, not thrown into the
            // route, which has no error boundary and would crash the page.
            let r: Awaited<ReturnType<typeof recordRelationshipIntake>>;
            try {
              r = await recordRelationshipIntake(vendorId, relationship.id, {
                ...(v as unknown as Omit<RelationshipIntakeInput, "regulatory_breach_notification">),
                regulatory_breach_notification: breach,
                ...(isReintake ? { change_reason: reason.trim() } : {}),
              });
            } catch {
              setError(TRANSPORT_FAILURE);
              return;
            }
            if (!r.ok) { setError(r.error); return; }
            onDone(`Classified: ${r.relationship?.criticality_band} criticality, ${r.relationship?.inherent_band} inherent risk → ${TIER_LABELS[r.relationship?.assessment_tier ?? ""] ?? r.relationship?.assessment_tier}.`);
          });
        }}
      >
        {pending
          ? "Deriving…"
          : !factsComplete
            ? "Answer every question to continue"
            : reasonOk
              ? "Record intake and classify"
              : "Say what changed to continue"}
      </button>
      {error && <p style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>{error}</p>}
    </div>
  );
}

export function VendorRelationshipsCard({ vendorId, relationships, loadFailed, manualCriticality }: { vendorId: string; relationships: VendorRelationship[]; loadFailed: boolean; manualCriticality: string | null }): JSX.Element {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [intakeFor, setIntakeFor] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string; engagementId?: string }>, success: string, after?: (id?: string) => void): void {
    setError(null); setNotice(null);
    start(async () => {
      let r: { ok: boolean; error?: string; engagementId?: string };
      try {
        r = await fn();
      } catch {
        setError(TRANSPORT_FAILURE);
        return;
      }
      if (!r.ok) { setError(r.error ?? "That didn't work."); return; }
      setNotice(success);
      after?.(r.engagementId);
      router.refresh();
    });
  }

  return (
    <div style={card} id="relationships">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Relationships &amp; classification</h3>
        <button type="button" onClick={() => setAdding((x) => !x)} disabled={pending} style={btn()}>{adding ? "Cancel" : "Add relationship"}</button>
      </div>

      {manualCriticality && (
        <p style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
          This vendor carries a manual classification (<span style={{ color: "#94a3b8" }}>{manualCriticality}</span>) recorded before Onboarding 2.0. It is kept with its provenance and is not used to derive anything below.
        </p>
      )}

      {loadFailed ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>Relationships could not be loaded. This is a load failure, not an empty list.</p>
      ) : relationships.length === 0 ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>No relationship recorded yet. Add what you buy from this vendor to begin the factual intake.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {relationships.map((r) => (
            <li key={r.id} style={{ padding: "10px 0", borderTop: "1px solid #1e293b", opacity: r.status === "inactive" ? 0.55 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#e2e8f0" }}>
                    {r.name}
                    {r.is_primary && <span style={{ marginLeft: 8, fontSize: 10, color: "#86efac" }}>PRIMARY</span>}
                    {r.status === "inactive" && <span style={{ marginLeft: 8, fontSize: 10, color: "#94a3b8" }}>INACTIVE</span>}
                  </div>
                  {r.service_description && <div style={{ fontSize: 11, color: "#64748b" }}>{r.service_description}</div>}
                </div>
                {r.classification_state === "intake_required" ? (
                  <span style={{ fontSize: 11, color: "#fde68a", border: "1px solid #854d0e", borderRadius: 6, padding: "2px 8px" }}>Intake required</span>
                ) : (
                  <span style={{ fontSize: 11, color: "#e2e8f0" }}>{TIER_LABELS[r.assessment_tier ?? ""] ?? r.assessment_tier}</span>
                )}
              </div>

              {r.classification_state === "classified" && (
                <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Band label="Criticality" band={r.criticality_band} score={r.criticality_score} />
                  <Band label="Inherent risk" band={r.inherent_band} score={r.inherent_score} />
                  <div style={{ minWidth: 110 }}>
                    <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Policy minimum</div>
                    <select
                      value={r.policy_minimum_tier ?? ""}
                      disabled={pending}
                      style={{ ...input(), width: "auto" }}
                      aria-label={`Policy minimum tier for ${r.name}`}
                      onChange={(e) => run(() => setRelationshipPolicy(vendorId, r.id, (e.target.value || null) as AssessmentTierValue | null), "Policy updated. Tier re-resolved from the same intake.")}
                    >
                      <option value="">None</option>
                      {ASSESSMENT_TIER_VALUES.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" style={btn()} onClick={() => setWhy(why === r.id ? null : r.id)}>{why === r.id ? "Hide basis" : "Why?"}</button>
                    <button type="button" style={btn()} disabled={pending} onClick={() => setIntakeFor(intakeFor === r.id ? null : r.id)}>Re-record intake</button>
                    <button type="button" style={btn(true)} disabled={pending} onClick={() => run(() => openAssessmentForRelationship(vendorId, r.id), "Assessment opened at the derived tier.", (id) => { if (id) router.push(`/vendor-engagements/${id}`); })}>
                      Open assessment
                    </button>
                  </div>
                </div>
              )}

              {r.classification_state === "intake_required" && intakeFor !== r.id && (
                <button type="button" style={{ ...btn(true), marginTop: 8 }} disabled={pending} onClick={() => setIntakeFor(r.id)}>Record factual intake</button>
              )}

              {why === r.id && (
                <div style={{ marginTop: 6 }}>
                  {/* WA-2: ONE renderer, shared with the engagement page. The
                      policy-raise line moved inside it, so both surfaces say
                      the same sentence about the same stored envelope. */}
                  <ClassificationBasisPanel
                    criticalityBasis={r.criticality_basis}
                    criticalityArithmeticBand={r.criticality_arithmetic_band}
                    criticalityBand={r.criticality_band}
                    inherentBasis={r.inherent_basis}
                    inherentArithmeticBand={r.inherent_arithmetic_band}
                    inherentBand={r.inherent_band}
                    tierBasis={r.tier_basis}
                    tierCalculatedMinimum={r.tier_calculated_minimum}
                    assessmentTier={r.assessment_tier}
                  />
                </div>
              )}

              {intakeFor === r.id && (
                <IntakeForm vendorId={vendorId} relationship={r} onDone={(msg) => { setIntakeFor(null); setNotice(msg); router.refresh(); }} />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <input placeholder="What you buy from this vendor (e.g. Card processing)" value={name} onChange={(e) => setName(e.target.value)} disabled={pending} style={input()} />
          <input placeholder="Service description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} disabled={pending} style={input()} />
          <button type="button" disabled={pending || !name.trim()} style={{ ...btn(true), padding: "6px 12px", fontSize: 12 }}
            onClick={() => run(() => addVendorRelationship(vendorId, { name: name.trim(), ...(desc.trim() ? { service_description: desc.trim() } : {}) }), `${name.trim()} added. Record its factual intake to classify it.`, () => { setAdding(false); setName(""); setDesc(""); })}>
            {pending ? "Saving…" : "Add relationship"}
          </button>
        </div>
      )}

      {error && <p style={{ marginTop: 10, fontSize: 12, color: "#fca5a5" }}>{error}</p>}
      {notice && <p style={{ marginTop: 10, fontSize: 12, color: "#86efac" }}>{notice}</p>}
    </div>
  );
}
