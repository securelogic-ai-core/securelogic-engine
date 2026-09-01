/**
 * evidenceLifecycleContract.ts — the ONE definition of what it means for an
 * evidence artifact to COUNT, plus the closed vocabularies ADR-0012 Step 2
 * introduced.
 *
 * A leaf module, deliberately, for the same reason `riskAcceptanceContract`
 * is one: the closure gate, the effectiveness ladder and posture must all agree
 * on "counts", and each of them already imports the others in some direction.
 * One definition, imported by all — the Metric Contract rule.
 *
 * ── NOTHING IMPORTS THIS YET, AND THAT IS THE POINT ──────────────────────────
 *
 * ADR-0012 Step 2 ships DARK. The closure gate, the ladder, posture and residual
 * risk read exactly what they read before; S4 is not wired;
 * `assuranceCoveredRequirementIds` is not called. This module exists so the
 * predicate can be reviewed, tested and argued about BEFORE it is wired to
 * anything, which is the opposite of how the current counting rules arrived.
 *
 * ── FAIL-CLOSED, AND WHERE THAT DEPARTS FROM THE ADR ─────────────────────────
 *
 * ADR-0012 §2.3 writes the time test as `valid_until IS NULL OR valid_until >=
 * CURRENT_DATE`, and §6.2 recommends that legacy NULL-validity rows KEEP
 * COUNTING behind a visible "no expiry" badge.
 *
 * This module does NOT do that. Owner direction, 2026-09-01: fail closed where
 * historical state cannot be known. `valid_until IS NULL` currently means two
 * incompatible things — "nobody has established this artifact's validity" and
 * "this artifact genuinely never expires" — and the ADR's predicate reads both
 * as valid. 20261080 adds `validity_basis` precisely so the two can be told
 * apart, and this predicate counts only the second.
 *
 * THE CONSEQUENCE, STATED SO NOBODY FLIPS THE FLAG BY ACCIDENT: every evidence
 * row that exists today carries `validity_basis = 'not_established'` (no
 * backfill was fabricated) and owns no link, so under this predicate the entire
 * legacy estate counts for NOTHING. That is the honest reading of an unknown
 * history, and it is also why `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` is default-off
 * and must stay off until a curation path lets humans establish validity for the
 * evidence they already rely on. Wiring this predicate before then would drop a
 * customer's existing proofs on the floor.
 */

/** `evidence.validity_basis` — mirrors evidence_validity_basis_check (20261080). */
export const EVIDENCE_VALIDITY_BASES = [
  "not_established",
  "artifact_dates",
  "perpetual",
] as const;
export type EvidenceValidityBasis = (typeof EVIDENCE_VALIDITY_BASES)[number];

/**
 * `evidence.assurance_class` — mirrors evidence_assurance_class_check (20261080).
 *
 * The axis the Step 3 validity policy keys on. Orthogonal to `evidence_type`
 * (form) and `source_type` (originating workflow): a SOC 2 report, a DPA, an ISO
 * certificate and a pen-test report are all `evidence_type='document'`.
 */
export const EVIDENCE_ASSURANCE_CLASSES = [
  "unclassified",
  "soc1",
  "soc2_type1",
  "soc2_type2",
  "iso_certification",
  "pen_test",
  "vulnerability_scan",
  "policy_document",
  "bcp_dr_test",
  "technical_configuration",
  "vendor_attestation",
  "privacy_agreement",
  "subprocessor_list",
  "ai_evaluation",
  "contract",
  "other_assurance_report",
] as const;
export type EvidenceAssuranceClass = (typeof EVIDENCE_ASSURANCE_CLASSES)[number];

/** `evidence_links.target_type` — mirrors evidence_links_target_type_check (20261081). */
export const EVIDENCE_LINK_TARGET_TYPES = [
  "finding",
  "vendor_engagement",
  "governance_review",
  "control_assessment",
  "obligation_assessment",
  "asset_assessment",
] as const;
export type EvidenceLinkTargetType = (typeof EVIDENCE_LINK_TARGET_TYPES)[number];

/** `evidence_links.link_kind` — mirrors evidence_links_kind_check (20261081). */
export const EVIDENCE_LINK_KINDS = ["origin", "reuse"] as const;
export type EvidenceLinkKind = (typeof EVIDENCE_LINK_KINDS)[number];

/** `evidence_links.detach_reason` — mirrors evidence_links_detach_reason_check (20261081). */
export const EVIDENCE_DETACH_REASONS = [
  "superseded",
  "incorrect_attachment",
  "no_longer_relevant",
  "withdrawn",
] as const;
export type EvidenceDetachReason = (typeof EVIDENCE_DETACH_REASONS)[number];

/** `evidence_lifecycle_events.event_type` — mirrors the CHECK in 20261082. */
export const EVIDENCE_LIFECYCLE_EVENT_TYPES = [
  "linked",
  "confirmed",
  "detached",
  "superseded",
  "validity_established",
  "assurance_class_established",
  "expiry_observed",
] as const;
export type EvidenceLifecycleEventType = (typeof EVIDENCE_LIFECYCLE_EVENT_TYPES)[number];

/**
 * SQL for "this evidence artifact COUNTS through this link, right now".
 * Expects `evidence` aliased as `e` and `evidence_links` aliased as `el`.
 *
 * Four conjuncts, each of which is a governance rule rather than a filter:
 *
 *  1. The link is live. A detached link is a record of a use that ENDED.
 *  2. The link is confirmed. Attaching is not confirming: a human said this
 *     artifact supports this claim IN THIS CONTEXT. A confirmation made
 *     elsewhere never leaks in, which is what makes reuse safe.
 *  3. The artifact's validity is ESTABLISHED. Unknown is not valid.
 *  4. It has not run out — unless it genuinely never does.
 *
 * The date test lives HERE, in the predicate, not only in a sweep worker, for
 * the same reason SQL_ACCEPTANCE_BINDING carries its own: an artifact that has
 * run out stops counting on the very next read, and a customer's posture must
 * never depend on whether a cron job fired this morning.
 *
 * SUPERSESSION IS DELIBERATELY ABSENT from this predicate. ADR-0012 §2.4 says
 * open links to a superseded version are never auto-detached and that counting
 * surfaces must NAME "a newer version exists" — a human relinks. Excluding a
 * superseded artifact here would auto-detach it by arithmetic instead. Use
 * SQL_EVIDENCE_SUPERSEDED to surface the flag beside the count.
 */
export const SQL_EVIDENCE_COUNTING = `
  el.detached_at IS NULL
  AND el.confirmed_at IS NOT NULL
  AND e.validity_basis <> 'not_established'
  AND (e.validity_basis = 'perpetual' OR e.valid_until >= CURRENT_DATE)
`;

/**
 * SQL for "a newer version of this artifact exists". Expects `evidence` as `e`.
 *
 * Currency is DERIVED at read (ADR-0012 §2.4), never stamped: there is no
 * `superseded_by` column to fall out of date. This is the fifth domain in the
 * model on that pattern.
 */
export const SQL_EVIDENCE_SUPERSEDED = `
  EXISTS (SELECT 1 FROM evidence newer WHERE newer.supersedes_evidence_id = e.id)
`;

/**
 * SQL for "this artifact's validity has run out". Expects `evidence` as `e`.
 *
 * Used to NOTIFY, never to flip state. Expiry stops an artifact contributing to
 * current posture at read time, and it never un-closes a closed finding
 * (ADR-0009: closure is a human decision already taken, and machines do not
 * reverse it). `not_established` is excluded here on purpose — an artifact whose
 * validity nobody ever established has not "expired", it was never eligible, and
 * conflating the two would fill the sweep with noise about rows that need
 * curation rather than renewal.
 */
export const SQL_EVIDENCE_EXPIRED = `
  e.validity_basis = 'artifact_dates' AND e.valid_until < CURRENT_DATE
`;
