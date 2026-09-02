/**
 * evidenceLinkWriter.ts — the governed writer for the evidence lifecycle.
 *
 * VA-S4. Steps 2 and 3 shipped the substrate deliberately WITHOUT a writer, so
 * the predicate could be argued about before anything depended on it. This is
 * that writer, and it is the only thing in the codebase permitted to create,
 * confirm, detach, curate or withdraw an evidence link.
 *
 * ── WHAT MAKES A LINK COUNT ──────────────────────────────────────────────────
 *
 * A link counts only when a human confirmed THAT link in THAT context. Not when
 * the artifact was uploaded, not when it was linked, and never by inheritance
 * from another context. Confirmation is all-or-none (timestamp + user +
 * non-empty note) and write-once, enforced by trigger in 20261081 — this module
 * refuses first so the caller gets a reason rather than a constraint violation.
 *
 * ── EVERY MUTATION WRITES ITS OWN RECORD ─────────────────────────────────────
 *
 * Each operation appends to evidence_lifecycle_events in the same transaction
 * as the change it describes. The events table is WORM and holds evidence_id /
 * link_id by value with no FK, so the record outlives what it describes — which
 * is what makes withdrawal safe.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ────────────────────────────────
 *
 * It does not decide whether a requirement is assured. It records what evidence
 * exists and what a human said about it; the sufficiency determination
 * (4C-4) reads that and applies its own vetoes. Keeping the two apart is why a
 * missing confirmation reads as NOT_EVALUABLE rather than as a quiet pass.
 */

import { pg } from "../infra/postgres.js";
import {
  EVIDENCE_LINK_TARGET_TYPES,
  EVIDENCE_LINK_KINDS,
  EVIDENCE_ASSURANCE_CLASSES,
  type EvidenceLinkTargetType,
  type EvidenceLinkKind,
  type EvidenceAssuranceClass,
} from "./evidenceLifecycleContract.js";
import { resolveValidityWindow, type ValidityPolicyRow } from "./evidenceValidityPolicy.js";

/** Detach reasons — mirrors evidence_links_detach_reason_check (20261081). */
export const EVIDENCE_DETACH_REASONS = [
  "superseded",
  "incorrect_attachment",
  "no_longer_relevant",
  "withdrawn",
] as const;
export type EvidenceDetachReason = (typeof EVIDENCE_DETACH_REASONS)[number];

export function isTargetType(v: unknown): v is EvidenceLinkTargetType {
  return typeof v === "string" && (EVIDENCE_LINK_TARGET_TYPES as readonly string[]).includes(v);
}
export function isLinkKind(v: unknown): v is EvidenceLinkKind {
  return typeof v === "string" && (EVIDENCE_LINK_KINDS as readonly string[]).includes(v);
}
export function isDetachReason(v: unknown): v is EvidenceDetachReason {
  return typeof v === "string" && (EVIDENCE_DETACH_REASONS as readonly string[]).includes(v);
}
export function isAssuranceClass(v: unknown): v is EvidenceAssuranceClass {
  return typeof v === "string" && (EVIDENCE_ASSURANCE_CLASSES as readonly string[]).includes(v);
}

/** Every failure is a slug the route maps to a status — never a raw DB error. */
export type WriterFailure =
  | "evidence_not_found"
  | "link_not_found"
  | "link_already_confirmed"
  | "link_already_detached"
  | "link_not_confirmed"
  | "requirement_grain_not_allowed"
  | "duplicate_live_link"
  | "assurance_class_already_established"
  | "validity_already_established"
  | "no_ratified_policy"
  | "policy_establishes_no_window"
  | "no_anchor_date"
  | "customer_duration_exceeds_ceiling"
  | "customer_duration_invalid"
  | "artifact_basis_not_permitted"
  | "artifact_dates_require_end"
  | "perpetual_requires_assertion";

export type WriterResult<T> = { ok: true; value: T } | { ok: false; reason: WriterFailure; detail?: string };

/**
 * Append one lifecycle event. Always called inside the caller's transaction, so
 * a change and its record commit together or not at all.
 */
async function recordEvent(
  organizationId: string,
  evidenceId: string,
  linkId: string | null,
  eventType: string,
  actorUserId: string | null,
  detail: Record<string, unknown>
): Promise<void> {
  await pg.query(
    `INSERT INTO evidence_lifecycle_events
       (organization_id, evidence_id, link_id, event_type, actor_user_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [organizationId, evidenceId, linkId, eventType, actorUserId, JSON.stringify(detail)]
  );
}

export type LinkInput = {
  organizationId: string;
  evidenceId: string;
  targetType: EvidenceLinkTargetType;
  targetId: string;
  targetRequirementId: string | null;
  linkKind: EvidenceLinkKind;
  actorUserId: string;
};

/**
 * Record a USE of an artifact. Deliberately UNCONFIRMED: linking says "this
 * artifact is offered here", confirming says "a human judged it sufficient
 * here". Collapsing the two would make every link count on creation, which is
 * the failure mode per-use confirmation exists to prevent.
 */
export async function linkEvidence(input: LinkInput): Promise<WriterResult<{ linkId: string }>> {
  const { organizationId, evidenceId, targetType, targetId, targetRequirementId, linkKind, actorUserId } = input;

  // target_requirement_id is only meaningful at the engagement x requirement
  // grain (20261081 CHECK). Refuse here so the caller gets a reason.
  if (targetRequirementId !== null && targetType !== "vendor_engagement") {
    return { ok: false, reason: "requirement_grain_not_allowed",
      detail: "target_requirement_id applies only to a vendor_engagement target." };
  }

  const ev = await pg.query(
    `SELECT id FROM evidence WHERE id = $1 AND organization_id = $2`,
    [evidenceId, organizationId]
  );
  if (ev.rowCount === 0) return { ok: false, reason: "evidence_not_found" };

  try {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO evidence_links
         (organization_id, evidence_id, target_type, target_id,
          target_requirement_id, link_kind, linked_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [organizationId, evidenceId, targetType, targetId, targetRequirementId, linkKind, actorUserId]
    );
    const linkId = r.rows[0]!.id;
    await recordEvent(organizationId, evidenceId, linkId, "linked", actorUserId, {
      target_type: targetType, target_id: targetId,
      target_requirement_id: targetRequirementId, link_kind: linkKind,
    });
    return { ok: true, value: { linkId } };
  } catch (err) {
    // The live-link partial unique index (20261081) is the expected collision:
    // one LIVE link per (org, artifact, target, requirement grain).
    if (String((err as { code?: string }).code) === "23505") {
      return { ok: false, reason: "duplicate_live_link",
        detail: "A live link already exists for this artifact in this context." };
    }
    throw err;
  }
}

/**
 * Confirm a link — the act that makes it COUNT.
 *
 * The conditional WHERE is the concurrency guard: two confirmations racing
 * cannot both succeed, and a zero rowCount is read as "already confirmed"
 * rather than ignored. An unchecked conditional update is a defect family this
 * codebase has hit repeatedly.
 */
export async function confirmLink(args: {
  organizationId: string; linkId: string; actorUserId: string; note: string;
}): Promise<WriterResult<{ evidenceId: string }>> {
  const { organizationId, linkId, actorUserId, note } = args;

  const cur = await pg.query<{ evidence_id: string; confirmed_at: string | null; detached_at: string | null }>(
    `SELECT evidence_id, confirmed_at, detached_at FROM evidence_links
      WHERE id = $1 AND organization_id = $2`,
    [linkId, organizationId]
  );
  if (cur.rowCount === 0) return { ok: false, reason: "link_not_found" };
  const row = cur.rows[0]!;
  if (row.detached_at !== null) return { ok: false, reason: "link_already_detached" };
  if (row.confirmed_at !== null) return { ok: false, reason: "link_already_confirmed" };

  const upd = await pg.query(
    `UPDATE evidence_links
        SET confirmed_at = NOW(), confirmed_by_user_id = $3,
            confirmation_note = $4, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
        AND confirmed_at IS NULL AND detached_at IS NULL`,
    [linkId, organizationId, actorUserId, note]
  );
  if ((upd.rowCount ?? 0) === 0) return { ok: false, reason: "link_already_confirmed" };

  await recordEvent(organizationId, row.evidence_id, linkId, "confirmed", actorUserId, { note });
  return { ok: true, value: { evidenceId: row.evidence_id } };
}

/**
 * Detach a link — end a USE without touching the artifact.
 *
 * Detaching is terminal: a detached link is history, and re-establishing the
 * use means a NEW link a human confirms again. That is what keeps "what was
 * relied on, when" readable.
 */
export async function detachLink(args: {
  organizationId: string; linkId: string; actorUserId: string;
  reason: EvidenceDetachReason; note?: string | null;
}): Promise<WriterResult<{ evidenceId: string }>> {
  const { organizationId, linkId, actorUserId, reason, note } = args;

  const cur = await pg.query<{ evidence_id: string; detached_at: string | null; confirmed_at: string | null }>(
    `SELECT evidence_id, detached_at, confirmed_at FROM evidence_links
      WHERE id = $1 AND organization_id = $2`,
    [linkId, organizationId]
  );
  if (cur.rowCount === 0) return { ok: false, reason: "link_not_found" };
  const row = cur.rows[0]!;
  if (row.detached_at !== null) return { ok: false, reason: "link_already_detached" };

  const upd = await pg.query(
    `UPDATE evidence_links
        SET detached_at = NOW(), detached_by_user_id = $3,
            detach_reason = $4, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND detached_at IS NULL`,
    [linkId, organizationId, actorUserId, reason]
  );
  if ((upd.rowCount ?? 0) === 0) return { ok: false, reason: "link_already_detached" };

  await recordEvent(organizationId, row.evidence_id, linkId, "detached", actorUserId, {
    reason, note: note ?? null, was_confirmed: row.confirmed_at !== null,
  });
  return { ok: true, value: { evidenceId: row.evidence_id } };
}

/** The live platform policy plus this org's override, for one class. */
export async function loadEffectivePolicy(
  organizationId: string,
  assuranceClass: string
): Promise<{
  policy: ValidityPolicyRow | null;
  orgDurationMonths: number | null;
  /** The LIVE policy version used, so a decision basis can name it (D15). */
  policyVersion: number | null;
}> {
  const p = await pg.query<{
    assurance_class: string; default_duration_months: number | null;
    max_duration_months: number | null; min_duration_months: number | null; anchor: string;
    requires_artifact_end: boolean; artifact_basis_permitted: boolean;
    bridge_required_above_months: number | null; no_window_reason: string | null;
    version: number;
  }>(
    `SELECT assurance_class, default_duration_months, max_duration_months,
            min_duration_months, anchor, requires_artifact_end,
            artifact_basis_permitted, bridge_required_above_months,
            no_window_reason, version
       FROM evidence_validity_policy
      WHERE assurance_class = $1 AND superseded_at IS NULL`,
    [assuranceClass]
  );
  const o = await pg.query<{ duration_months: number }>(
    `SELECT duration_months FROM organization_evidence_validity_settings
      WHERE organization_id = $1 AND assurance_class = $2 AND superseded_at IS NULL`,
    [organizationId, assuranceClass]
  );
  const row = p.rows[0];
  return {
    policy: row
      ? {
          assuranceClass: row.assurance_class,
          defaultDurationMonths: row.default_duration_months,
          maxDurationMonths: row.max_duration_months,
          minDurationMonths: row.min_duration_months,
          anchor: row.anchor as ValidityPolicyRow["anchor"],
          requiresArtifactEnd: row.requires_artifact_end === true,
          artifactBasisPermitted: row.artifact_basis_permitted === true,
          bridgeRequiredAboveMonths: row.bridge_required_above_months ?? null,
          noWindowReason: row.no_window_reason ?? null,
        }
      : null,
    orgDurationMonths: o.rows[0]?.duration_months ?? null,
    policyVersion: row?.version ?? null,
  };
}

/* =========================================================
   Governed anchor resolution (D9, D10)

   The owner ruled that the writer must DERIVE the anchor from governed evidence
   state and must not let a caller manufacture freshness with an arbitrary
   supplied date. That ruling does not apply uniformly, and the line is precise:

     collected_at    the observation date is a FACT ON THE EVIDENCE ROW. The
                     caller is ignored entirely. uploaded_at never substitutes.
     object_cadence  the cadence belongs to a LINKED GOVERNED OBJECT. The caller
                     is ignored entirely; missing linkage fails closed.
     report_period_end / artifact_term
                     the date is STATED BY THE ARTIFACT and a human reads it off
                     the document. That reading IS the governed act under D0/D16,
                     so the curator's value is the authority — there is nowhere
                     else it could come from.
   ========================================================= */

type GovernedAnchor =
  | { ok: true; anchorDate: string | null; linkedCadenceUntil: string | null }
  | { ok: false; reason: string };

async function resolveGovernedAnchor(args: {
  organizationId: string;
  evidenceId: string;
  assuranceClass: string;
  anchor: ValidityPolicyRow["anchor"];
  sourceType: string;
  sourceId: string;
  /** The engagement this artifact was collected by, when it was. */
  engagementId: string | null;
  collectedAt: string | null;
  callerAnchorDate: string | null;
}): Promise<GovernedAnchor> {
  const {
    organizationId, assuranceClass, anchor, sourceType, sourceId, engagementId,
    collectedAt, callerAnchorDate,
  } = args;

  if (anchor === "collected_at") {
    // D9: required, and taken from the row. A caller-supplied date is not a
    // weaker source, it is the wrong source.
    if (!collectedAt) return { ok: false, reason: "collected_at_required" };
    return { ok: true, anchorDate: collectedAt, linkedCadenceUntil: null };
  }

  if (anchor === "object_cadence") {
    // The class decides which object it must follow. A policy document may not
    // borrow an engagement's cadence, or the linkage would prove nothing.
    if (assuranceClass === "policy_document") {
      if (sourceType !== "policy_review") return { ok: false, reason: "no_linked_object_cadence" };
      const r = await pg.query<{ last_reviewed_at: string | null; next_review_at: string | null }>(
        `SELECT to_char(last_reviewed_at, 'YYYY-MM-DD') AS last_reviewed_at,
                to_char(next_review_at,   'YYYY-MM-DD') AS next_review_at
           FROM policies WHERE id = $1 AND organization_id = $2`,
        [sourceId, organizationId]
      );
      const row = r.rows[0];
      if (!row || !row.last_reviewed_at || !row.next_review_at) {
        return { ok: false, reason: "no_linked_object_cadence" };
      }
      return { ok: true, anchorDate: row.last_reviewed_at, linkedCadenceUntil: row.next_review_at };
    }

    if (assuranceClass === "vendor_attestation") {
      // The cadence comes from evidence.engagement_id — the CONSTRAINED column
      // (evidence_engagement_source_consistent, 20260925), which the vendor
      // portal already populates for every artifact a vendor supplies against
      // an engagement. A legacy 'vendor_review' row points at
      // vendor_assessments, which carries NO engagement column and no cadence,
      // so it fails closed rather than guessing at a join that does not exist.
      if (engagementId === null) return { ok: false, reason: "no_linked_object_cadence" };
      const r = await pg.query<{ decided_at: string | null; next_review_due: string | null }>(
        `SELECT to_char(decided_at, 'YYYY-MM-DD')      AS decided_at,
                to_char(next_review_due, 'YYYY-MM-DD') AS next_review_due
           FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
        [engagementId, organizationId]
      );
      const row = r.rows[0];
      if (!row || !row.decided_at || !row.next_review_due) {
        return { ok: false, reason: "no_linked_object_cadence" };
      }
      return { ok: true, anchorDate: row.decided_at, linkedCadenceUntil: row.next_review_due };
    }

    return { ok: false, reason: "no_linked_object_cadence" };
  }

  // report_period_end / artifact_term / none — the artifact states it, a human
  // reads it. There is no governed alternative source.
  return { ok: true, anchorDate: callerAnchorDate, linkedCadenceUntil: null };
}

/**
 * Establish an artifact's governance envelope: what kind of assurance it is,
 * and how long it is good for.
 *
 * WRITE-ONCE, by trigger (20261084) and by the conditional updates here. A
 * curator says what an artifact is; nobody restates it afterwards, because a
 * determination already made would silently change meaning. To change what an
 * artifact asserts, supersede it.
 */
export async function establishAssurance(args: {
  organizationId: string;
  evidenceId: string;
  assuranceClass: EvidenceAssuranceClass;
  /**
   * ISO date the window measures from. Honoured ONLY for artifact-stated
   * anchors (report_period_end / artifact_term). For collected_at and
   * object_cadence classes the writer derives the anchor from governed state
   * and this value is ignored — see resolveGovernedAnchor.
   */
  anchorDate: string | null;
  /** What the artifact ITSELF asserts as its end, if the curator read one. */
  artifactAssertedUntil: string | null;
  /**
   * D13 / D14 / D11 / D3: what KIND of basis the curator is committing.
   *
   *   'policy'         compute the window from the ratified policy (default).
   *   'artifact_dates' commit the end the ARTIFACT states, with no platform
   *                    duration. The only mechanism for contract and
   *                    other_assurance_report, which are ratified to carry NO
   *                    policy row.
   *   'perpetual'      commit that the artifact asserts NO end. Explicit only:
   *                    a missing end date must never imply perpetual.
   */
  basis?: "policy" | "artifact_dates" | "perpetual";
  /** Required for 'perpetual'. Says who asserted it and on what reading. */
  perpetualAssertion?: string | null;
  actorUserId: string;
}): Promise<WriterResult<{ validityBasis: string; validUntil: string | null; reason: string }>> {
  const {
    organizationId, evidenceId, assuranceClass, anchorDate, artifactAssertedUntil,
    actorUserId,
  } = args;
  const basisRequest = args.basis ?? "policy";

  const cur = await pg.query<{
    assurance_class: string; validity_basis: string;
    source_type: string; source_id: string; engagement_id: string | null;
    collected_at: string | null;
  }>(
    `SELECT assurance_class, validity_basis, source_type, source_id::text AS source_id,
            engagement_id::text AS engagement_id,
            to_char(collected_at, 'YYYY-MM-DD') AS collected_at
       FROM evidence
      WHERE id = $1 AND organization_id = $2`,
    [evidenceId, organizationId]
  );
  if (cur.rowCount === 0) return { ok: false, reason: "evidence_not_found" };
  if (cur.rows[0]!.assurance_class !== "unclassified") {
    return { ok: false, reason: "assurance_class_already_established",
      detail: `Already ${cur.rows[0]!.assurance_class}. Supersede the artifact instead.` };
  }
  if (cur.rows[0]!.validity_basis !== "not_established") {
    return { ok: false, reason: "validity_already_established" };
  }
  const evRow = cur.rows[0]!;

  const { policy, orgDurationMonths, policyVersion } = await loadEffectivePolicy(organizationId, assuranceClass);

  // ── The human-committed artifact basis (D13 / D14) ────────────────────────
  //
  // Permitted ONLY where the live policy row bears no duration. Where a
  // duration-bearing policy exists, an artifact's asserted end may CAP the
  // computed window (rule 3) and nothing more: letting a curator commit
  // artifact dates directly there would be a route around D4's re-evidence
  // cadence and D10's 24-month ceiling, which global principle 4 forbids —
  // customer configuration may tighten freely but may never defeat a platform
  // epistemic ceiling.
  if (basisRequest !== "policy") {
    // A class with NO policy row permits the artifact basis by absence — that
    // is the only mechanism D13 (contract) and D14 (other_assurance_report)
    // have. A class that DOES carry a ratified policy permits it only when the
    // ratified policy SAYS so, so the decision lives in versioned policy
    // content rather than being inferred here.
    if (policy && !policy.artifactBasisPermitted) {
      return { ok: false, reason: "artifact_basis_not_permitted",
        detail: `The ratified policy for ${assuranceClass} does not permit committing the artifact's own dates in place of the platform window; an artifact end can only narrow that window, never replace it.` };
    }
    const asserted =
      typeof artifactAssertedUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(artifactAssertedUntil.trim())
        ? artifactAssertedUntil.trim()
        : null;

    if (basisRequest === "artifact_dates" && asserted === null) {
      return { ok: false, reason: "artifact_dates_require_end" };
    }
    const assertion = (args.perpetualAssertion ?? "").trim();
    if (basisRequest === "perpetual" && assertion === "") {
      return { ok: false, reason: "perpetual_requires_assertion",
        detail: "A missing end date is not an assertion of perpetuity. State what the artifact says." };
    }

    // ONE statement establishes class AND validity together. Two statements
    // could commit the class while the validity write refused, and the
    // 20261084 write-once trigger would then make the artifact permanently
    // un-curatable: class set, validity not_established, both frozen. The
    // route commits on a normal return (asTenant flushes after COMMIT), so a
    // RETURNED failure between the two would have persisted exactly that.
    const est0 = await pg.query(
      `UPDATE evidence
          SET assurance_class = $3,
              validity_basis  = $4,
              valid_from      = $5::date,
              valid_until     = $6::date
        WHERE id = $1 AND organization_id = $2
          AND assurance_class = 'unclassified'
          AND validity_basis  = 'not_established'`,
      [evidenceId, organizationId, assuranceClass, basisRequest, anchorDate,
       basisRequest === "artifact_dates" ? asserted : null]
    );
    if ((est0.rowCount ?? 0) === 0) return { ok: false, reason: "assurance_class_already_established" };
    await recordEvent(organizationId, evidenceId, null, "assurance_class_established", actorUserId, {
      assurance_class: assuranceClass,
    });

    await recordEvent(organizationId, evidenceId, null, "validity_established", actorUserId, {
      validity_basis: basisRequest, valid_from: anchorDate,
      valid_until: basisRequest === "artifact_dates" ? asserted : null,
      artifact_asserted: true,
      perpetual_assertion: basisRequest === "perpetual" ? assertion : undefined,
    });
    return { ok: true, value: {
      validityBasis: basisRequest,
      validUntil: basisRequest === "artifact_dates" ? asserted : null,
      reason: basisRequest === "artifact_dates" ? "artifact_asserted_end" : "artifact_asserts_no_end",
    } };
  }

  // ── The policy path ───────────────────────────────────────────────────────
  const governed = policy
    ? await resolveGovernedAnchor({
        organizationId, evidenceId, assuranceClass, anchor: policy.anchor,
        sourceType: evRow.source_type, sourceId: evRow.source_id,
        engagementId: evRow.engagement_id, collectedAt: evRow.collected_at,
        callerAnchorDate: anchorDate,
      })
    : ({ ok: true, anchorDate, linkedCadenceUntil: null } as GovernedAnchor);

  const window = governed.ok
    ? resolveValidityWindow({
        policy, orgDurationMonths,
        anchorDate: governed.anchorDate,
        artifactAssertedUntil,
        linkedCadenceUntil: governed.linkedCadenceUntil,
      })
    : ({ basis: "not_established", validUntil: null, reason: governed.reason } as const);
  const effectiveAnchorDate = governed.ok ? governed.anchorDate : null;

  // The class is established even when no window can be. Knowing WHAT an
  // artifact is remains useful, and a NOT_EVALUABLE window is the honest
  // outcome rather than a reason to refuse the curation outright.
  // ONE statement, for the reason given in the artifact-basis path above. When
  // no window could be established the row keeps validity_basis
  // 'not_established' with both dates NULL, which is the shape check's
  // not_established arm — the class is still recorded, because knowing WHAT an
  // artifact is stays useful even when nothing establishes how long it is good
  // for.
  const established = window.basis === "policy_default";
  const classUpd = await pg.query(
    `UPDATE evidence
        SET assurance_class = $3,
            validity_basis  = $4,
            valid_from      = $5::date,
            valid_until     = $6::date
      WHERE id = $1 AND organization_id = $2
        AND assurance_class = 'unclassified'
        AND validity_basis  = 'not_established'`,
    [
      evidenceId, organizationId, assuranceClass,
      established ? "policy_default" : "not_established",
      established ? effectiveAnchorDate : null,
      established ? window.validUntil : null,
    ]
  );
  if ((classUpd.rowCount ?? 0) === 0) return { ok: false, reason: "assurance_class_already_established" };
  await recordEvent(organizationId, evidenceId, null, "assurance_class_established", actorUserId, {
    assurance_class: assuranceClass,
  });

  if (window.basis === "policy_default") {
    await recordEvent(organizationId, evidenceId, null, "validity_established", actorUserId, {
      validity_basis: "policy_default", valid_from: effectiveAnchorDate, valid_until: window.validUntil,
      duration_months: window.durationMonths, source: window.source,
      capped_by_artifact: window.cappedByArtifact,
      capped_by_linked_cadence: window.cappedByLinkedCadence,
      // G: a determination must stay replayable against the policy that was in
      // force when it was made, so the version is part of the record.
      policy_version: policyVersion,
      anchor: policy?.anchor ?? null,
    });
    return { ok: true, value: { validityBasis: "policy_default", validUntil: window.validUntil, reason: window.reason } };
  }

  // No window could be established. The class is recorded, validity stays
  // not_established, and the REASON is recorded so the gap is legible.
  await recordEvent(organizationId, evidenceId, null, "validity_established", actorUserId, {
    validity_basis: "not_established", reason: window.reason,
    policy_version: policyVersion, anchor: policy?.anchor ?? null,
  });
  return { ok: true, value: { validityBasis: "not_established", validUntil: null, reason: window.reason } };
}
