import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "./auditLog.js";

/**
 * riskPromotionService.ts — Finding→Risk promotion (ADR-0004 A, accepted for
 * implementation 2026-07-28; Risk Lifecycle capability, tracked in #694).
 *
 * The conveyor between the two finished halves of risk governance: an
 * acceptance reaching 'approved' files a WORM governance record and closes
 * operational work — but until this service, the enduring exposure reached
 * the Enterprise Risk Register only if a human retyped it. Promotion makes
 * the register trustworthy: every governed acceptance lands there.
 *
 * Semantics (per the promotion design memo, FINDING-RISK-PROMOTION-MEMO.md):
 *  - Trigger: the proposed→approved transition ONLY. legacy_unverified
 *    acceptances never reach the approve route (refused upstream with
 *    `legacy_acceptance_requires_completion`), so they structurally cannot
 *    promote — the ADR's exclusion, enforced by construction.
 *  - Create-or-link, one risk per finding: the dedup identity is
 *    risks(organization_id, source_type='finding_promotion', source_id=
 *    finding_id). A re-accepted finding (expired → re-proposed → re-approved)
 *    LINKS to its existing register risk; it never mints a second one.
 *    N-findings→1-risk consolidation is a human register act, out of scope.
 *  - The promoted risk enters the register as status='accepted' — the exact
 *    state the governance decision put it in — with the acceptance carrying
 *    the evidence (owner, rationale, expiry, approver, SoD).
 *  - lifecycle_state stays NULL while the lifecycle machine is dark; when
 *    R1 enables, promotion seeds 'accepted' per the DS-8 approver ruling
 *    (memo §5).
 *  - Reuses the acceptance's approval — no new approval shape (ADR-0004 B:
 *    promotion is the standing rule's first test, not its first violation).
 *
 * Failure is NON-FATAL to the approval: the governance record is primary and
 * already durable. A failed promotion logs loudly (`risk_promotion_failed`)
 * and the zero-writer reconciliation query (memo §7) finds any approved
 * acceptance with promoted_risk_id NULL.
 *
 * DARK by default: SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED === "true".
 */

export function riskPromotionEnabled(): boolean {
  return process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED === "true";
}

/** Finding likelihood vocabulary → risks likelihood vocabulary. */
const LIKELIHOOD_MAP: Record<string, string> = {
  very_high: "very_likely",
  high: "likely",
  medium: "possible",
  low: "unlikely",
  very_low: "rare",
};

export interface PromotionInput {
  organizationId: string;
  acceptanceId: string;
  findingId: string;
  /** The approver (for the audit event). */
  actorUserId: string | null;
  actorApiKeyId: string | null;
}

export interface PromotionResult {
  promoted: boolean;
  riskId: string | null;
  created: boolean; // false when linked to an existing promoted risk
}

/**
 * Create-or-link the register risk for an approved acceptance and stamp
 * promoted_risk_id. Idempotent: safe to re-run for the same acceptance.
 */
export async function promoteApprovedAcceptance(
  input: PromotionInput
): Promise<PromotionResult> {
  if (!riskPromotionEnabled()) {
    return { promoted: false, riskId: null, created: false };
  }

  const { organizationId, acceptanceId, findingId } = input;

  // Everything the risk row needs, in one read: finding facts + the
  // acceptance's owner display name (owner is TEXT on risks).
  const src = await pg.query<{
    title: string;
    severity: string | null;
    domain: string | null;
    likelihood: string | null;
    rationale: string | null;
    owner_name: string | null;
  }>(
    `SELECT f.title,
            f.severity,
            f.domain,
            f.likelihood,
            a.rationale,
            u.name AS owner_name
       FROM findings f
       JOIN finding_risk_acceptances a
         ON a.id = $2 AND a.organization_id = f.organization_id
       LEFT JOIN users u
         ON u.id = a.owner_user_id AND u.organization_id = f.organization_id
      WHERE f.id = $1 AND f.organization_id = $3`,
    [findingId, acceptanceId, organizationId]
  );
  const row = src.rows[0];
  if (!row) {
    logger.warn(
      { event: "risk_promotion_source_missing", organizationId, acceptanceId, findingId },
      "riskPromotion: finding/acceptance pair not found — skipping"
    );
    return { promoted: false, riskId: null, created: false };
  }

  const rating =
    row.severity === "Critical" || row.severity === "High" ||
    row.severity === "Moderate" || row.severity === "Low"
      ? row.severity
      : "Moderate";
  const likelihood = LIKELIHOOD_MAP[row.likelihood ?? ""] ?? "possible";
  const description =
    (row.rationale ? `${row.rationale.trim()}\n\n` : "") +
    "Promoted from an approved finding risk acceptance (governed decision: " +
    "owner, rationale, expiry and approver recorded on the acceptance).";

  // Create-or-link on the (org, finding) promotion identity. The INSERT's
  // NOT EXISTS + the follow-up SELECT make re-approval link, never duplicate
  // (same guard pattern as the matcher's D-14 fix).
  const inserted = await pg.query<{ id: string }>(
    `INSERT INTO risks (
       organization_id, title, description, domain, likelihood, impact,
       risk_rating, status, owner, source_type, source_id
     )
     SELECT $1, $2, $3, $4, $5, $6, $6, 'accepted', $7, 'finding_promotion', $8::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM risks
         WHERE organization_id = $1
           AND source_type = 'finding_promotion'
           AND source_id = $8::uuid
      )
     RETURNING id`,
    [
      organizationId,
      row.title,
      description,
      row.domain ?? "General",
      likelihood,
      rating,
      row.owner_name,
      findingId,
    ]
  );

  let riskId = inserted.rows[0]?.id ?? null;
  const created = riskId !== null;
  if (!riskId) {
    const existing = await pg.query<{ id: string }>(
      `SELECT id FROM risks
        WHERE organization_id = $1
          AND source_type = 'finding_promotion'
          AND source_id = $2::uuid
        ORDER BY created_at ASC
        LIMIT 1`,
      [organizationId, findingId]
    );
    riskId = existing.rows[0]?.id ?? null;
  }
  if (!riskId) {
    logger.error(
      { event: "risk_promotion_failed", organizationId, acceptanceId, findingId },
      "riskPromotion: neither created nor found a register risk"
    );
    return { promoted: false, riskId: null, created: false };
  }

  // The forward hook the 20260907 migration shipped with zero writers —
  // this is its first writer. promoted_risk_id is explicitly mutable under
  // the acceptance's immutability trigger.
  await pg.query(
    `UPDATE finding_risk_acceptances
        SET promoted_risk_id = $3, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [acceptanceId, organizationId, riskId]
  );

  writeAuditEvent({
    organizationId,
    actorUserId: input.actorUserId,
    actorApiKeyId: input.actorApiKeyId,
    eventType: "risk.promoted",
    resourceType: "risk",
    resourceId: riskId,
    payload: {
      finding_id: findingId,
      acceptance_id: acceptanceId,
      created,
    },
    ipAddress: null,
  });

  logger.info(
    { event: "risk_promoted", organizationId, findingId, riskId, created },
    created
      ? "riskPromotion: register risk created from approved acceptance"
      : "riskPromotion: approved acceptance linked to existing register risk"
  );

  return { promoted: true, riskId, created };
}
