/**
 * evidenceValidityPolicy.ts — how long a piece of governed evidence stays good
 * for, and WHO decided that.
 *
 * VA-S4 wiring-plan step 3. Authority: owner ratification 2026-09-01 of D0, D1,
 * D15 and D16 in docs/design/VA-EVIDENCE-validity-policy-RATIFICATION-MEMO.md,
 * implemented as migration 20261083.
 *
 * ── WHY THIS IS A LEAF MODULE WITH NO IMPORTS ────────────────────────────────
 *
 * It deliberately does NOT import `evidenceLifecycleContract`. That module's
 * build guard asserts nothing consumes the Step 2 counting predicate, and a
 * file-level grep cannot tell "imported a vocabulary constant" from "wired the
 * predicate". Keeping this module standalone keeps that guard meaningful. The
 * two vocabularies are held in lockstep by a test that imports both, which is
 * the right place for a cross-check that must not become a runtime dependency.
 *
 * ── THE THREE RULES, IN THE ORDER THEY BIND ──────────────────────────────────
 *
 * 1. NO RATIFIED POLICY MEANS NO VALIDITY. A class with no policy row, or a
 *    policy that establishes no window, yields `not_established`. There is no
 *    catch-all fallback duration, because a default for unknown artifacts is a
 *    universal TTL wearing a different name (memo D14). This is why
 *    `soc2_type1` — ratified as "its own rule" with no number named — resolves
 *    to no window at all rather than to a guess.
 *
 * 2. THE CUSTOMER MAY TIGHTEN FREELY, AND LOOSEN ONLY TO THE CEILING (D15).
 *    A shorter duration than the platform default needs no permission. A longer
 *    one is bounded by `maxDurationMonths`. The database enforces this too
 *    (`org_evidence_validity_guardrail`); this module refuses independently so
 *    a caller that assembles a window without a round-trip cannot slip past it.
 *
 * 3. THE ARTIFACT ALWAYS OUTRANKS THE POLICY. A computed window may narrow what
 *    the artifact itself asserts; it may never extend it. Nobody — us or the
 *    customer — gets to declare an expired certificate current, because those
 *    dates belong to the body that issued it.
 *
 * ── NOT WIRED ────────────────────────────────────────────────────────────────
 *
 * Step 3 ships behind the same `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` flag as Step
 * 2 and introduces no flag of its own. No route, worker or backfill computes a
 * window yet: the governed writer is the next package, and S4 stays unwired
 * until it lands. Nothing here backfills anything — D16 ratified that humans
 * establish class and validity at creation.
 */

/** `evidence_validity_policy.anchor` — mirrors the CHECK in 20261083. */
export const VALIDITY_ANCHORS = [
  "report_period_end",
  "collected_at",
  "artifact_stated_date",
  /**
   * D7 / D10: follow a LINKED governed object's own review cadence rather than
   * a duration of our own. The caller resolves the linked object and supplies
   * both its last-event date (the anchor) and its next-due date; unlinked
   * evidence establishes nothing.
   */
  "object_cadence",
  "none",
] as const;
export type ValidityAnchor = (typeof VALIDITY_ANCHORS)[number];

/**
 * The bases a computed outcome may carry. A superset check against
 * `EVIDENCE_VALIDITY_BASES` lives in the test, not here — see the header.
 */
export type ComputedValidityBasis = "not_established" | "policy_default";

/** One live row of `evidence_validity_policy`. */
export type ValidityPolicyRow = {
  assuranceClass: string;
  /** NULL means this class establishes no policy-derived window. */
  defaultDurationMonths: number | null;
  /** The ceiling a customer may loosen to. NULL alongside a NULL default. */
  maxDurationMonths: number | null;
  /** The platform's sanity floor for its own default. NOT a customer bound. */
  minDurationMonths: number | null;
  anchor: ValidityAnchor;
  /**
   * D3: when true the artifact's own stated end is MANDATORY, not merely a cap.
   * A row of this class with no asserted end resolves to not_established rather
   * than taking the policy window — a certificate whose expiry nobody recorded
   * must never inherit a duration.
   */
  requiresArtifactEnd: boolean;
  /**
   * D11 / D13 / D14: may a curator commit the ARTIFACT's own dates instead of a
   * computed window? False for every class carrying a ratified duration, so an
   * artifact basis can never route around a platform ceiling.
   */
  artifactBasisPermitted: boolean;
  /**
   * D2: beyond this many months the window counts ONLY when a governed bridge
   * letter covers the gap. Null when the class has no bridge condition.
   */
  bridgeRequiredAboveMonths: number | null;
  /**
   * For a ratified class that establishes NO window, the reason it was ratified
   * that way — so a refusal says what was decided rather than a generic slug.
   */
  noWindowReason: string | null;
};

export type ValidityWindowInput = {
  /** The live platform policy for this artifact's class, or null if none. */
  policy: ValidityPolicyRow | null;
  /** The org's live override in months, or null if it has not set one. */
  orgDurationMonths: number | null;
  /** ISO `YYYY-MM-DD` the window is measured from (per the policy's anchor). */
  anchorDate: string | null;
  /**
   * What the artifact ITSELF asserts as its end, if a human established it.
   * A computed window is capped to this and can never exceed it.
   */
  artifactAssertedUntil: string | null;
  /**
   * For `object_cadence` policies only: the linked governed object's own next-due
   * date (a policy's next review, an engagement's next reassessment). The
   * SHORTER of this and the platform ceiling binds, so a long customer cadence
   * can never outlive the ceiling (D10). Null when nothing is linked, which
   * fails closed.
   */
  linkedCadenceUntil?: string | null;
  /**
   * D2: how far a governed bridge letter covers, when one is linked. No bridge
   * artifact exists yet, so this is always null today and the bridge condition
   * is therefore unsatisfiable — which is exactly the ratified behaviour. The
   * bridge package supplies this and nothing else changes.
   */
  bridgeCoverageUntil?: string | null;
};

export type ValidityWindow =
  | {
      basis: "not_established";
      validUntil: null;
      /** Machine-stable slug. Always present, so a refusal is never mute. */
      reason: string;
    }
  | {
      basis: "policy_default";
      validUntil: string;
      durationMonths: number;
      /** Which layer supplied the duration actually used. */
      source: "platform" | "customer";
      /** True when rule 3 narrowed the window to the artifact's own end. */
      cappedByArtifact: boolean;
      /**
       * True when a linked object's cadence ended before the platform ceiling
       * (D7 / D10: the shorter governed cadence wins).
       */
      cappedByLinkedCadence: boolean;
      reason: string;
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Add whole months to an ISO date, clamping the day to the last day of the
 * target month. `2025-01-31` + 1 month is `2025-02-28`, not an overflow into
 * March — a validity window must never silently gain days.
 */
export function addMonths(isoDate: string, months: number): string {
  const parts = isoDate.split("-");
  const y = parseInt(parts[0] ?? "", 10);
  const m = parseInt(parts[1] ?? "", 10);
  const d = parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`addMonths: not an ISO date: ${isoDate}`);
  }
  const zeroBased = m - 1 + months;
  const targetYear = y + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12;
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Resolve the validity window for one artifact.
 *
 * Every refusal returns `not_established` with a reason slug rather than
 * throwing: an unresolvable window is a normal, expected outcome under a
 * fail-closed policy, and the caller must be able to record WHY.
 */
export function resolveValidityWindow(input: ValidityWindowInput): ValidityWindow {
  const { policy, orgDurationMonths, anchorDate, artifactAssertedUntil } = input;
  const linkedCadenceUntil = input.linkedCadenceUntil ?? null;
  const bridgeCoverageUntil = input.bridgeCoverageUntil ?? null;

  // Rule 1 — no ratified policy, no validity.
  if (!policy) {
    return { basis: "not_established", validUntil: null, reason: "no_ratified_policy" };
  }
  if (policy.defaultDurationMonths === null || policy.anchor === "none") {
    return {
      basis: "not_established",
      validUntil: null,
      // A ratified class that establishes nothing says WHY it was ratified that
      // way. Falling back to the generic slug would read as "nobody decided".
      reason: policy.noWindowReason ?? "policy_establishes_no_window",
    };
  }

  if (!anchorDate || !ISO_DATE.test(anchorDate.trim())) {
    return { basis: "not_established", validUntil: null, reason: "no_anchor_date" };
  }

  // Rule 1b (D3) — some classes REQUIRE the artifact's own end. An ISO
  // certificate states its expiry; one whose expiry nobody recorded must fail
  // closed rather than inherit the policy's duration.
  const asserted =
    artifactAssertedUntil && ISO_DATE.test(artifactAssertedUntil.trim())
      ? artifactAssertedUntil.trim()
      : null;
  if (policy.requiresArtifactEnd && asserted === null) {
    return { basis: "not_established", validUntil: null, reason: "artifact_end_required" };
  }

  // Rule 1c (D7 / D10) — an object_cadence policy establishes nothing without
  // the linked object it is supposed to follow. Missing linkage fails closed.
  const cadenceUntil =
    linkedCadenceUntil && ISO_DATE.test(linkedCadenceUntil.trim())
      ? linkedCadenceUntil.trim()
      : null;
  if (policy.anchor === "object_cadence" && cadenceUntil === null) {
    return { basis: "not_established", validUntil: null, reason: "no_linked_object_cadence" };
  }

  // Rule 2 — the customer layer, bounded on the loosening side only.
  let durationMonths = policy.defaultDurationMonths;
  let source: "platform" | "customer" = "platform";

  if (orgDurationMonths !== null) {
    if (!Number.isInteger(orgDurationMonths) || orgDurationMonths < 1) {
      return {
        basis: "not_established",
        validUntil: null,
        reason: "customer_duration_invalid",
      };
    }
    if (policy.maxDurationMonths !== null && orgDurationMonths > policy.maxDurationMonths) {
      return {
        basis: "not_established",
        validUntil: null,
        reason: "customer_duration_exceeds_ceiling",
      };
    }
    durationMonths = orgDurationMonths;
    source = "customer";
  }

  // Rule 2c (D2) — a duration past the bridge threshold counts ONLY when a
  // governed bridge letter covers the gap. The ratified ceiling above the
  // threshold is preserved; what the threshold does is make it CONDITIONAL. No
  // bridge artifact exists yet, so this refuses today and becomes reachable the
  // moment the bridge package supplies coverage.
  if (
    policy.bridgeRequiredAboveMonths !== null &&
    durationMonths > policy.bridgeRequiredAboveMonths
  ) {
    const bridged =
      bridgeCoverageUntil !== null && ISO_DATE.test(bridgeCoverageUntil.trim())
        ? bridgeCoverageUntil.trim()
        : null;
    const wouldEnd = addMonths(anchorDate.trim(), durationMonths);
    if (bridged === null || bridged < wouldEnd) {
      return {
        basis: "not_established",
        validUntil: null,
        reason: "governed_bridge_required",
      };
    }
  }

  let validUntil = addMonths(anchorDate.trim(), durationMonths);

  // Rule 2b (D7 / D10) — for an object_cadence policy the duration above is the
  // ABSOLUTE CEILING, not the cadence. The linked object supplies the cadence,
  // and the SHORTER of the two binds. This is what stops a 120-month customer
  // engagement cadence from keeping a 10-year-old attestation current, and it
  // is equally what lets a 6-month policy review cadence bind tighter than the
  // 24-month ceiling.
  let cappedByLinkedCadence = false;
  if (policy.anchor === "object_cadence" && cadenceUntil !== null && cadenceUntil < validUntil) {
    validUntil = cadenceUntil;
    cappedByLinkedCadence = true;
  }

  // Rule 3 — the artifact always outranks the policy. Last, and unconditional:
  // neither a platform duration nor a customer setting nor a linked cadence may
  // outlive what the artifact itself asserts.
  let cappedByArtifact = false;
  if (asserted !== null && validUntil > asserted) {
    validUntil = asserted;
    cappedByArtifact = true;
    cappedByLinkedCadence = false;
  }

  return {
    basis: "policy_default",
    validUntil,
    durationMonths,
    source,
    cappedByArtifact,
    cappedByLinkedCadence,
    reason: cappedByArtifact
      ? "capped_by_artifact_asserted_end"
      : cappedByLinkedCadence
        ? "capped_by_linked_object_cadence"
        : "policy_window",
  };
}

/**
 * Is a resolved window current as of a given date?
 *
 * Separate from resolution on purpose: currency is a read-time question, and
 * conflating the two is how a stored window drifts away from what it meant.
 */
export function isWindowCurrent(window: ValidityWindow, asOf: string): boolean {
  if (window.basis !== "policy_default") return false;
  return window.validUntil >= asOf;
}
