/**
 * AssessmentCompositionSection — what SecureLogic selected for this engagement
 * and why, BEFORE it is issued (Assessment Composition v1, goal §G).
 *
 * Server-rendered from the immutable composition snapshot. It shows:
 *   - the headline: how many items, at what depth, how many already satisfied
 *     by governed evidence, and whether the honest result is "no questionnaire";
 *   - the applicable assessment domains and how many questions each carries;
 *   - the sixteen Core Assurance objectives with their outcome and the
 *     customer-facing reason (asked / satisfied by evidence / not applicable);
 *   - the additional requirements the relationship's facts, obligations and
 *     domains added, grouped by domain, with the rule that added each.
 *
 * Deliberately NOT shown: weights, scores, rule internals. Rule ids appear
 * only as small provenance tags; the sentence beside them is the explanation.
 */

import type { VendorEngagementComposition, VendorAssessmentDomain, CompositionCoreObjective } from "@/lib/api";
import { VENDOR_ASSESSMENT_DOMAIN_LABELS } from "@/lib/api";
import { TIER_LABELS } from "@/lib/vendorRelationshipIntake";

const DEPTH_LABEL: Record<string, string> = {
  full: "full answer + evidence",
  confirm: "confirmation",
  attest: "attestation",
};

const OUTCOME: Record<CompositionCoreObjective["outcome"], { label: string; color: string; bg: string }> = {
  asked: { label: "Asked", color: "#93c5fd", bg: "rgba(37,99,235,0.15)" },
  evidence_satisfied: { label: "Satisfied by evidence", color: "#86efac", bg: "rgba(22,101,52,0.2)" },
  not_applicable: { label: "Not applicable", color: "#9ca3af", bg: "rgba(75,85,99,0.25)" },
  not_provisioned: { label: "Not in library", color: "#fde68a", bg: "rgba(161,98,7,0.2)" },
};

function Chip({ outcome }: { outcome: CompositionCoreObjective["outcome"] }): JSX.Element {
  const o = OUTCOME[outcome];
  return (
    <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 11, color: o.color, background: o.bg, whiteSpace: "nowrap" }}>
      {o.label}
    </span>
  );
}

export default function AssessmentCompositionSection({
  composition,
  loadFailed,
  state,
}: {
  composition: VendorEngagementComposition | null;
  loadFailed: boolean;
  state: string;
}): JSX.Element {
  const card: React.CSSProperties = { padding: 16, border: "1px solid #1f2937", borderRadius: 8, background: "#0f172a" };
  const h2: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "#e5e7eb" };
  const muted: React.CSSProperties = { color: "#9ca3af", fontSize: 13, margin: 0 };

  if (loadFailed) {
    return (
      <section style={card} aria-label="Assessment composition">
        <h2 style={h2}>Assessment composition</h2>
        <p style={{ ...muted, color: "#fde68a" }}>The composition could not be loaded. Reload the page.</p>
      </section>
    );
  }
  if (!composition) {
    return (
      <section style={card} aria-label="Assessment composition">
        <h2 style={h2}>Assessment composition</h2>
        <p style={muted}>
          {state === "draft" || state === "scoping"
            ? "Not composed yet. Compose the assessment to see what SecureLogic selects for this relationship and why — before anything is sent."
            : "This engagement was composed before composition records existed; its questionnaire is shown below as issued."}
        </p>
      </section>
    );
  }

  const s = composition.summary;
  const core = composition.core_assurance;
  const byDomain = new Map<VendorAssessmentDomain | "none", typeof composition.additional>();
  for (const item of composition.additional) {
    const key = item.domain ?? "none";
    byDomain.set(key, [...(byDomain.get(key) ?? []), item]);
  }
  const evidenceSatisfied = s.evidence_satisfied;

  return (
    <section style={card} aria-label="Assessment composition">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={h2}>Assessment composition</h2>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          {TIER_LABELS[composition.tier] ?? composition.tier} · composed {composition.resolved_at.slice(0, 10)} · rules v
          {composition.scope_rule_version}
          {composition.core_assurance_version && ` · core set v${composition.core_assurance_version}`}
        </span>
      </div>

      {s.no_questionnaire_required ? (
        <div style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #14532d", background: "rgba(22,101,52,0.12)" }}>
          <div style={{ fontSize: 14, color: "#86efac" }}>No formal questionnaire is required for this relationship.</div>
          <p style={{ ...muted, marginTop: 4 }}>
            From the declared facts, none of the {core ? core.objectives.length : "core"} presumptive control objectives applies, and no
            relationship fact, obligation or assessment domain adds a requirement. Each objective&apos;s reason is listed below.
            Record the intake again if the relationship changes.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: "#d1d5db" }}>
          <Stat label="Questions" value={String(s.asked)} />
          <Stat label="Full answer + evidence" value={String(s.asked_full)} />
          <Stat label="Attestation" value={String(s.asked_attest)} />
          <Stat label="Satisfied by evidence" value={String(evidenceSatisfied)} tone={evidenceSatisfied > 0 ? "#86efac" : undefined} />
          <Stat label="Not applicable" value={String(s.core_not_applicable)} />
          {s.nominal_target !== null && (
            <Stat
              label="Tier target"
              value={`${s.nominal_target}${s.mandatory_overage ? ` (+${s.mandatory_overage} floor)` : ""}`}
            />
          )}
        </div>
      )}

      {composition.domains.length > 0 && (
        <p style={{ ...muted, marginTop: 10 }}>
          Applicable domains:{" "}
          {composition.domains.map((d, i) => (
            <span key={d.domain}>
              {i > 0 && " · "}
              <span style={{ color: "#e5e7eb" }}>{VENDOR_ASSESSMENT_DOMAIN_LABELS[d.domain] ?? d.domain}</span> {d.asked}
              {d.evidence_satisfied > 0 && <span style={{ color: "#86efac" }}> (+{d.evidence_satisfied} evidenced)</span>}
            </span>
          ))}
        </p>
      )}

      {evidenceSatisfied > 0 && (
        <p style={{ ...muted, marginTop: 6 }}>
          {evidenceSatisfied} requirement{evidenceSatisfied === 1 ? " is" : "s are"} already covered by approved, in-validity independent
          assurance — {evidenceSatisfied === 1 ? "it is" : "they are"} asked as a confirmation rather than in full.
        </p>
      )}

      {core && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            SecureLogic Core Assurance Set · {s.core_applicable} of {core.objectives.length} apply
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }} aria-label="Core assurance objectives">
            {core.objectives.map((o) => (
              <li key={o.reference} style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 10, alignItems: "start", padding: "6px 8px", border: "1px solid #1f2937", borderRadius: 6 }}>
                <span style={{ fontSize: 11, color: "#6b7280", paddingTop: 2 }}>{o.reference}</span>
                <span style={{ display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 13, color: o.outcome === "not_applicable" ? "#9ca3af" : "#e5e7eb" }}>{o.title}</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>
                    {o.rationale}
                    {o.depth && <span style={{ color: "#6b7280" }}> · {DEPTH_LABEL[o.depth] ?? o.depth}</span>}
                    {o.outcome === "evidence_satisfied" && o.evidence && typeof o.evidence["valid_until"] === "string" && (
                      <span style={{ color: "#6b7280" }}> · evidence valid until {String(o.evidence["valid_until"])}</span>
                    )}
                  </span>
                </span>
                <Chip outcome={o.outcome} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {composition.additional.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            Added for this relationship · {composition.additional.length}
          </div>
          {[...byDomain.entries()].map(([domain, items]) => (
            <details key={domain} style={{ marginBottom: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#e5e7eb" }}>
                {domain === "none" ? "Other" : VENDOR_ASSESSMENT_DOMAIN_LABELS[domain] ?? domain} · {items.length}
              </summary>
              <ul style={{ listStyle: "none", padding: "6px 0 0 12px", margin: 0, display: "grid", gap: 4 }}>
                {items.map((a) => (
                  <li key={a.requirement_id} style={{ fontSize: 12, color: "#9ca3af" }}>
                    <span style={{ color: "#d1d5db" }}>
                      {a.reference} · {a.title}
                    </span>{" "}
                    <span style={{ color: "#6b7280" }}>({a.framework}; {DEPTH_LABEL[a.depth] ?? a.depth})</span>
                    {a.outcome === "evidence_satisfied" && <span style={{ color: "#86efac" }}> · satisfied by evidence</span>}
                    <div style={{ color: "#6b7280" }}>{a.reasons.map((r) => r.rationale).filter((v, i, arr) => arr.indexOf(v) === i).join(" ")}</div>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}

      {/*
        WA-2. What was NOT asked, and on what independent assurance. All three
        of these were already carried by the snapshot and rendered nowhere:
        an analyst could see the questions but not the coverage that removed
        some of them, nor the requirements the rules or the tier cap left out.
        A composition that only shows what it kept cannot be defended.
      */}
      {composition.coverage.computed && (
        <p style={{ ...muted, marginTop: 10 }}>
          Independent assurance coverage{" "}
          <span style={{ color: "#6b7280" }}>
            (as of {composition.coverage.as_of ?? "—"}
            {composition.coverage.version && `, ${composition.coverage.version}`})
          </span>
          :{" "}
          <span style={{ color: composition.coverage.covered_count > 0 ? "#86efac" : "#9ca3af" }}>
            {composition.coverage.covered_count} covered
          </span>
          {" · "}
          <span style={{ color: composition.coverage.gap_count > 0 ? "#fde68a" : "#9ca3af" }}>
            {composition.coverage.gap_count} gap{composition.coverage.gap_count === 1 ? "" : "s"}
          </span>
          {!composition.coverage.applied && (
            <span style={{ color: "#6b7280" }}>
              {" "}
              — computed but not applied to this composition.
            </span>
          )}
        </p>
      )}

      {s.excluded_by_rules > 0 && (
        <p style={{ ...muted, marginTop: 6 }}>
          {s.excluded_by_rules} requirement{s.excluded_by_rules === 1 ? "" : "s"} in the library
          {s.excluded_by_rules === 1 ? " was" : " were"} excluded because no rule in this
          scope-rule set includes {s.excluded_by_rules === 1 ? "it" : "them"} for this
          relationship.
        </p>
      )}

      {s.truncated && s.truncated.dropped > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ ...muted, color: "#fde68a", margin: 0 }}>
            {s.truncated.dropped} lower-priority requirement{s.truncated.dropped === 1 ? "" : "s"} exceeded the tier&apos;s question target of{" "}
            {s.truncated.cap} and {s.truncated.dropped === 1 ? "was" : "were"} left out; the core objectives and obligations are never dropped.
          </p>
          {composition.dropped.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "#9ca3af" }}>
                Which ones
              </summary>
              <ul style={{ listStyle: "none", padding: "6px 0 0 12px", margin: 0, display: "grid", gap: 3 }}>
                {composition.dropped.map((d) => (
                  <li key={d.requirement_id} style={{ fontSize: 12, color: "#9ca3af" }}>
                    <span style={{ color: "#d1d5db" }}>
                      {d.reference} · {d.title}
                    </span>{" "}
                    <span style={{ color: "#6b7280" }}>({d.framework})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 16, color: tone ?? "#e5e7eb" }}>{value}</span>
    </div>
  );
}
