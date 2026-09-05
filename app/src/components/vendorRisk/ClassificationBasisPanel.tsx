/**
 * ClassificationBasisPanel — how a relationship got its rating, rendered once
 * (WA-2, owner walkthrough remediation).
 *
 * ── Why this is a shared component and not a second renderer ─────────────────
 *
 * The three basis envelopes (`criticality_basis`, `inherent_basis`,
 * `tier_basis`) were already stored, versioned and tenant-visible, and the
 * vendor page already rendered them behind a "Why?" toggle. The engagement page
 * showed the resulting BANDS and nothing else, so an analyst reading an
 * engagement could see that it was rated Critical and had to leave the page to
 * find out why. That was the walkthrough's first finding.
 *
 * The fix is one renderer used by both surfaces, not a second one written to
 * look similar. Two renderers over the same stored envelope drift the moment
 * one of them gains a field, and a rating explained two different ways in two
 * places is worse than a rating explained in one.
 *
 * ── What it renders, and what it deliberately does not ──────────────────────
 *
 * The envelope is self-contained by contract (methodologyVersion.ts: "a reader
 * must never have to re-derive anything to understand the number"), so this
 * component computes NOTHING. It repeats the stored factors, the named rules
 * that fired, the arithmetic-vs-final divergence, and the policy decision. If a
 * value is not in the envelope it is not shown — never inferred, never
 * recalculated from the bands beside it.
 */

import type {
  AssessmentTierValue,
  ClassificationBasis,
  RiskBandValue,
  TierBasis,
} from "@/lib/api";
import { TIER_LABELS } from "@/lib/vendorRelationshipIntake";

const muted = "#94a3b8";
const dim = "#475569";
const body = "#cbd5e1";
const rule = "#fdba74";

/** One engine's terms: the weighted factors, then the rules that moved it. */
export function BasisBlock({
  title,
  basis,
  arithmeticBand,
  finalBand,
}: {
  title: string;
  basis: ClassificationBasis;
  /** The pre-adjustment band, shown only when a rule moved the result. */
  arithmeticBand?: RiskBandValue | null;
  finalBand?: RiskBandValue | null;
}): JSX.Element {
  const moved =
    arithmeticBand != null && finalBand != null && arithmeticBand !== finalBand;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: muted }}>
        {title}{" "}
        <span style={{ color: dim }}>
          · {basis.method} v{basis.methodology_version}
        </span>
      </div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: body }}>
        {basis.factors.map((f) => (
          <li key={f.dimension}>
            {f.explanation}{" "}
            <span style={{ color: dim }}>
              ({f.raw} × {f.weight.toFixed(2)} = {f.contribution})
            </span>
          </li>
        ))}
        {basis.adjustments.map((a) => (
          <li key={a.rule_id} style={{ color: rule }}>
            {a.rule_id}: {a.explanation}
          </li>
        ))}
      </ul>
      {/*
        The ratified requirement: "if arithmetic produces Low and a floor raises
        it to High, the system must expose the arithmetic result, the rule, the
        reason it fired, the adjustment, and the final rating." The rules are
        listed above; this is the before-and-after they produced.
      */}
      {moved && (
        <div style={{ marginTop: 3, fontSize: 11, color: rule }}>
          Arithmetic alone gave {arithmeticBand}; the rule(s) above raised it to {finalBand}.
        </div>
      )}
    </div>
  );
}

/** The joint function, plus what customer policy asked for and whether it applied. */
export function TierBasisBlock({
  basis,
  calculatedMinimum,
  finalTier,
}: {
  basis: TierBasis;
  calculatedMinimum?: AssessmentTierValue | null;
  finalTier?: AssessmentTierValue | null;
}): JSX.Element {
  const raised =
    calculatedMinimum != null && finalTier != null && calculatedMinimum !== finalTier;
  return (
    <div style={{ marginTop: 8, fontSize: 11, color: body }}>
      <div style={{ color: muted }}>
        Assessment tier{" "}
        <span style={{ color: dim }}>
          · {basis.method} v{basis.methodology_version}
        </span>
      </div>
      <div>
        Criticality {basis.criticality_band} × Inherent risk {basis.inherent_band} on the
        approved matrix.
      </div>
      {basis.adjustments.map((a) => (
        <div key={a.rule_id} style={{ color: rule }}>
          {a.rule_id}: {a.explanation}
        </div>
      ))}
      {basis.policy && (
        <div style={{ color: basis.policy.applied ? "#93c5fd" : muted }}>
          Policy requested {TIER_LABELS[basis.policy.requested] ?? basis.policy.requested}:{" "}
          {basis.policy.applied ? "applied." : `not applied — ${basis.policy.reason}`}
        </div>
      )}
      {raised && (
        <div style={{ color: "#93c5fd" }}>
          SecureLogic&apos;s calculated minimum was{" "}
          {TIER_LABELS[calculatedMinimum!] ?? calculatedMinimum}; policy raised it to{" "}
          {TIER_LABELS[finalTier!] ?? finalTier}.
        </div>
      )}
    </div>
  );
}

/**
 * All three, together. Renders nothing when the classification is absent —
 * a relationship without factual intake has no basis, and inventing an empty
 * panel for it would read as "assessed, with no reasons" rather than
 * "not assessed".
 */
export default function ClassificationBasisPanel({
  criticalityBasis,
  criticalityArithmeticBand,
  criticalityBand,
  inherentBasis,
  inherentArithmeticBand,
  inherentBand,
  tierBasis,
  tierCalculatedMinimum,
  assessmentTier,
}: {
  criticalityBasis: ClassificationBasis | null;
  criticalityArithmeticBand: RiskBandValue | null;
  criticalityBand: RiskBandValue | null;
  inherentBasis: ClassificationBasis | null;
  inherentArithmeticBand: RiskBandValue | null;
  inherentBand: RiskBandValue | null;
  tierBasis: TierBasis | null;
  tierCalculatedMinimum: AssessmentTierValue | null;
  assessmentTier: AssessmentTierValue | null;
}): JSX.Element | null {
  if (!criticalityBasis && !inherentBasis && !tierBasis) return null;
  return (
    <div>
      {criticalityBasis && (
        <BasisBlock
          title="Criticality"
          basis={criticalityBasis}
          arithmeticBand={criticalityArithmeticBand}
          finalBand={criticalityBand}
        />
      )}
      {inherentBasis && (
        <BasisBlock
          title="Inherent risk"
          basis={inherentBasis}
          arithmeticBand={inherentArithmeticBand}
          finalBand={inherentBand}
        />
      )}
      {tierBasis && (
        <TierBasisBlock
          basis={tierBasis}
          calculatedMinimum={tierCalculatedMinimum}
          finalTier={assessmentTier}
        />
      )}
    </div>
  );
}
