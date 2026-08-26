/**
 * vendorEngagements.ts — the INTERNAL Vendor Assurance workflow API.
 *
 * The counterpart to `vendorPortal.ts`. That file is the external surface a
 * vendor sees; this is the one the customer's own reviewers drive, and the two
 * share exactly one thing — the `vendor_engagements` spine.
 *
 * Middleware chain, identical to the rest of the vendor-assurance surface:
 *   vendorAssuranceFeatureFlag → requireApiKey → attachOrganizationContext
 *     → requireEntitlement("premium") → denyContributor() → asTenant(handler)
 *
 * ── Where the deterministic models are actually called ───────────────────────
 * All three run HERE, at the route, and their output is persisted with its
 * basis. They are never invoked from a display path: a score that recomputes on
 * read is a score that can change without anyone deciding it should, which is
 * precisely what the methodology's versioning rules exist to prevent.
 *
 *   POST   /vendor-engagements                  computes inherent risk
 *   POST   /vendor-engagements/:id/scope        resolves and FREEZES the scope
 *   POST   /vendor-engagements/:id/recompute    effectiveness + residual
 *
 * ── Rating over score ────────────────────────────────────────────────────────
 * `*_rating` is authoritative and `*_score` is a derived projection. A reviewer
 * may override a rating; nothing overwrites their override, and the arithmetic
 * band is kept alongside so divergence is visible rather than lost.
 *
 * ── The state machine is the only authority on transitions ───────────────────
 * No handler compares a status inline. Every transition asks `canTransition`
 * with the actor `internal`, and the guarded UPDATE re-checks the source status
 * so a concurrent request cannot double-transition.
 */

import { Router, type Request, type Response } from "express";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";
import { vendorAssuranceFeatureFlag } from "../lib/vendorAssuranceFeatureFlag.js";

import {
  ACCESS_LEVELS,
  AI_AUTONOMY_LEVELS,
  AI_INVOLVEMENT_LEVELS,
  BUSINESS_CRITICALITY_LEVELS,
  CONCENTRATION_LEVELS,
  DATA_SENSITIVITY_LEVELS,
  DATA_VOLUME_BANDS,
  FOURTH_PARTY_LEVELS,
  HOSTING_MODELS,
  OPERATIONAL_DEPENDENCY_LEVELS,
  RECOVERABILITY_LEVELS,
  REGULATORY_EXPOSURE_LEVELS,
  computeVendorInherentRisk,
  type InherentRiskInput,
} from "../lib/vendorRisk/inherentRisk.js";
import { resolveEngagementScope } from "../lib/vendorRisk/scopeResolver.js";
import {
  assuranceFor,
  computeControlEffectiveness,
  type ControlResponse,
  type ResponseStatus,
} from "../lib/vendorRisk/controlEffectiveness.js";
import { computeResidualRisk } from "../lib/vendorRisk/residualRisk.js";
import { RISK_BANDS, type RiskBand } from "../lib/vendorRisk/riskBands.js";
import {
  canTransition,
  isScopeMutable,
  isInherentOverridable,
  type EngagementState,
} from "../lib/vendorRisk/engagementStateMachine.js";
import { METHODOLOGY_VERSION, SCOPE_RULE_VERSION } from "../lib/vendorRisk/methodologyVersion.js";
import { promoteFindings, type PromotableControl } from "../lib/vendorRisk/findingPromotion.js";
import { computeAnalysisCoverage } from "../lib/vendorRisk/analysisCoverage.js";
import { scheduleVendorScoreRecompute } from "../lib/vendorRiskScoreRecompute.js";
import { mintInviteToken } from "../lib/vendorPortal/portalTokens.js";
import { sendVendorInviteEmail } from "../lib/vendorPortal/inviteEmail.js";
import { resolveVendorContact, type VendorContactRow } from "./vendorContacts.js";
import { sqlFindingActive } from "../lib/metricDefinitions.js";

const router = Router();

/* =========================================================
   Supersede-on-pass observation (ruled 2026-08-22).

   A PASS SUPERSEDES NOTHING AUTOMATICALLY — the fourth appearance of the
   machines-observe-humans-decide principle (scanner reappearance never
   reopens; monitoring recommendation never transitions; a pen-test retest
   never closes; this: an engagement control transitioning to pass never
   closes the finding it once promoted). Closure stays with the human gate
   (SoD, evidence, decision_state); the machine's obligation is to NAME the
   divergence, everywhere a human is looking, and to DERIVE it fresh at read
   rather than caching a marker that would itself go stale the moment the
   vendor revises again. finding_lifecycle_events is deliberately NOT used:
   it is a closed-vocabulary TRANSITION ledger, and a pass is an observation.

   CROSS-ENGAGEMENT (ruled 2026-08-23): the observation spans every
   engagement of the SAME VENDOR — an annual re-assessment opened as a new
   engagement must not make the earlier engagement's finding invisible.
   Equivalence is deterministic-or-declared: same vendor_id (FK) + same
   requirement_id (FK), never text matching; a finding whose requirement_id
   is NULL is surfaced as equivalence_undetermined instead of being guessed
   about or silently dropped. Each named row carries source_engagement_id so
   provenance of BOTH engagements survives.

   `pass` and `not_applicable` are both "the source no longer asserts a gap",
   but they are DIFFERENT assertions ("we do it" vs "does not apply") and a
   human closing on the second is often adjudicating a scope dispute — so the
   row says which. `as_of` is requirement_responses.assessed_at: when the
   vendor last asserted this answer (the portal upsert is its only writer).
   ========================================================= */
type SupersededBySource = {
  finding_id: string;
  reference: string;
  requirement_id: string;
  source_engagement_id: string;
  current_response: "pass" | "not_applicable";
  as_of: string;
};

type SupersedeObservation = {
  superseded: SupersededBySource[];
  /** Open engagement findings of the SAME VENDOR whose requirement_id is
   *  NULL: equivalence to a current response cannot be established
   *  deterministically, so the machine SAYS SO instead of guessing
   *  (cross-engagement ruling, 2026-08-23). */
  equivalence_undetermined: string[];
};

/** Open vendor_engagement findings — of ANY engagement of this engagement's
 *  vendor (cross-engagement ruling, 2026-08-23: a new engagement must not
 *  make an earlier engagement's finding invisible) — whose requirement's
 *  CURRENT response in THIS engagement no longer asserts a gap.
 *
 *  Equivalence is established deterministically or not at all: the finding's
 *  source engagement must belong to the same vendor (FK identity) and the
 *  requirement_id must match exactly (FK identity). No text matching. A
 *  finding whose requirement_id is NULL is reported as undetermined, never
 *  silently dropped and never guessed at.
 *
 *  Tenant-first on every leg — the joins must never be able to plan a
 *  cross-org read. `rr.assessment_type = 'vendor'` pins the response lane so
 *  a future non-vendor assessment row for the same requirement cannot fan
 *  out the observation. */
async function listFindingsSupersededBySource(
  organizationId: string,
  engagementId: string
): Promise<SupersedeObservation> {
  const rows = await pg.query<SupersededBySource>(
    `SELECT f.id AS finding_id, r.reference_id AS reference, f.requirement_id,
            f.source_id AS source_engagement_id,
            rr.status AS current_response, rr.assessed_at AS as_of
       FROM vendor_engagements e
       JOIN vendor_engagements fe
         ON fe.organization_id = e.organization_id
        AND fe.vendor_id = e.vendor_id
       JOIN findings f
         ON f.organization_id = fe.organization_id
        AND f.source_type = 'vendor_engagement'
        AND f.source_id::text = fe.id::text
       JOIN requirement_responses rr
         ON rr.organization_id = f.organization_id
        AND rr.engagement_id = e.id
        AND rr.assessment_type = 'vendor'
        AND rr.requirement_id = f.requirement_id
       JOIN requirements r ON r.id = f.requirement_id
      WHERE e.organization_id = $1
        AND e.id = $2
        AND f.requirement_id IS NOT NULL
        AND rr.status IN ('pass', 'not_applicable')
        AND ${sqlFindingActive("f.operational_status")}
      ORDER BY r.reference_id, f.id`,
    [organizationId, engagementId]
  );
  const undetermined = await pg.query<{ id: string }>(
    `SELECT f.id
       FROM vendor_engagements e
       JOIN vendor_engagements fe
         ON fe.organization_id = e.organization_id
        AND fe.vendor_id = e.vendor_id
       JOIN findings f
         ON f.organization_id = fe.organization_id
        AND f.source_type = 'vendor_engagement'
        AND f.source_id::text = fe.id::text
      WHERE e.organization_id = $1
        AND e.id = $2
        AND f.requirement_id IS NULL
        AND ${sqlFindingActive("f.operational_status")}
      ORDER BY f.id`,
    [organizationId, engagementId]
  );
  return {
    superseded: rows.rows,
    equivalence_undetermined: undetermined.rows.map((r) => r.id),
  };
}

function orgOf(req: Request): string | null {
  return (
    (req as unknown as { organizationContext?: { organizationId?: string } }).organizationContext
      ?.organizationId ?? null
  );
}
function userOf(req: Request): string | null {
  return (req as unknown as { userId?: string }).userId ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
   Intake validation.

   Every field is REQUIRED. A defaulted inherent-risk input is the worst
   available failure mode: it produces a confident score from answers nobody
   gave, and the resulting rating is indistinguishable from an assessed one.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The allowed values are IMPORTED from the scoring module, never re-declared.
 *
 * An earlier draft of this file listed them by hand and got `ai_autonomy` wrong
 * — it offered `assistive | recommending | autonomous` where the model scores
 * `none | human_in_the_loop | human_on_the_loop | autonomous_consequential`.
 * Every AI-bearing engagement would have been rejected as invalid, or worse,
 * accepted and then scored against a level the multiplier table has no entry
 * for. Importing makes the drift impossible rather than merely unlikely.
 */
const INTAKE_FIELDS: Record<string, readonly string[]> = {
  data_sensitivity: DATA_SENSITIVITY_LEVELS,
  data_volume: DATA_VOLUME_BANDS,
  access_level: ACCESS_LEVELS,
  operational_dependency: OPERATIONAL_DEPENDENCY_LEVELS,
  recoverability: RECOVERABILITY_LEVELS,
  business_criticality: BUSINESS_CRITICALITY_LEVELS,
  regulatory_exposure: REGULATORY_EXPOSURE_LEVELS,
  ai_involvement: AI_INVOLVEMENT_LEVELS,
  ai_autonomy: AI_AUTONOMY_LEVELS,
  hosting_model: HOSTING_MODELS,
  fourth_party_exposure: FOURTH_PARTY_LEVELS,
  concentration: CONCENTRATION_LEVELS,
};

type IntakeValidation =
  | { ok: true; input: InherentRiskInput }
  | { ok: false; error: string; missing: string[]; invalid: Array<{ field: string; allowed: readonly string[] }> };

export function validateIntake(body: unknown): IntakeValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  const missing: string[] = [];
  const invalid: Array<{ field: string; allowed: readonly string[] }> = [];
  const out: Record<string, unknown> = {};

  for (const [field, allowed] of Object.entries(INTAKE_FIELDS)) {
    const value = b[field];
    if (value === undefined || value === null || value === "") {
      missing.push(field);
      continue;
    }
    if (typeof value !== "string" || !allowed.includes(value)) {
      invalid.push({ field, allowed });
      continue;
    }
    out[field] = value;
  }

  // Boolean, so it needs its own handling: `false` is a legitimate answer and
  // must not read as absent.
  if (typeof b.regulatory_breach_notification !== "boolean") {
    missing.push("regulatory_breach_notification");
  } else {
    out.regulatory_breach_notification = b.regulatory_breach_notification;
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, error: "incomplete_intake", missing, invalid };
  }
  return { ok: true, input: out as unknown as InherentRiskInput };
}

/* =========================================================
   POST /api/vendor-engagements — open an engagement.

   Inherent risk is computed HERE, from the intake, and stored with its basis.
   The tier derives from the band, and the frozen scope will derive from the
   tier — so this one call determines the shape of the whole engagement.
   ========================================================= */
export async function createEngagement(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const vendorId = typeof body.vendor_id === "string" ? body.vendor_id.trim() : "";
  if (!vendorId) {
    res.status(400).json({ error: "vendor_id_required" });
    return;
  }

  const engagementType =
    typeof body.engagement_type === "string" ? body.engagement_type : "initial";
  if (!["initial", "periodic", "targeted", "event_driven"].includes(engagementType)) {
    res.status(400).json({ error: "invalid_engagement_type" });
    return;
  }

  const intake = validateIntake(body.intake ?? body);
  if (!intake.ok) {
    // Deliberately explicit about WHICH fields. A generic 400 on a twelve-field
    // form is a support ticket.
    res.status(400).json(intake);
    return;
  }

  const inherent = computeVendorInherentRisk(intake.input);

  try {
    const vendor = await pg.query<{ id: string; name: string }>(
      `SELECT id, name FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [vendorId, organizationId]
    );
    if (vendor.rowCount === 0) {
      res.status(404).json({ error: "vendor_not_found" });
      return;
    }

    const inserted = await pg.query<{ id: string }>(
      `INSERT INTO vendor_engagements
         (organization_id, vendor_id, engagement_type, status, title,
          inherent_score, inherent_rating, inherent_arithmetic_rating, inherent_basis,
          assessment_tier, methodology_version, scope_rule_version, created_by_user_id,
          data_sensitivity, data_volume_band, access_level, operational_dependency,
          recoverability, business_criticality, regulatory_exposure,
          regulatory_breach_notification,
          ai_involvement, ai_autonomy, hosting_model, fourth_party_exposure,
          concentration_snapshot, concentration_snapshot_at)
       VALUES ($1, $2, $3, 'draft', $4,
               $5, $6, $7, $8::jsonb,
               $9, $10, $11, $12,
               $13, $14, $15, $16,
               $17, $18, $19,
               $20,
               $21, $22, $23, $24,
               $25, NOW())
       RETURNING id`,
      [
        organizationId,
        vendorId,
        engagementType,
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim().slice(0, 300)
          : `${vendor.rows[0]!.name} assurance review`,
        inherent.score,
        inherent.band,
        inherent.arithmetic_band,
        JSON.stringify(inherent.basis),
        inherent.tier,
        METHODOLOGY_VERSION,
        SCOPE_RULE_VERSION,
        userOf(req),
        intake.input.data_sensitivity,
        intake.input.data_volume,
        intake.input.access_level,
        intake.input.operational_dependency,
        intake.input.recoverability,
        intake.input.business_criticality,
        intake.input.regulatory_exposure,
        intake.input.regulatory_breach_notification,
        intake.input.ai_involvement,
        intake.input.ai_autonomy,
        intake.input.hosting_model,
        intake.input.fourth_party_exposure,
        intake.input.concentration,
      ]
    );

    const id = inserted.rows[0]!.id;

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.created",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        vendor_id: vendorId,
        engagement_type: engagementType,
        inherent_score: inherent.score,
        inherent_rating: inherent.band,
        tier: inherent.tier,
        methodology_version: METHODOLOGY_VERSION,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({
      id,
      status: "draft",
      inherent: {
        score: inherent.score,
        rating: inherent.band,
        arithmetic_rating: inherent.arithmetic_band,
        tier: inherent.tier,
        // The whole explanation travels with the number. A reviewer must never
        // have to re-derive anything to understand a rating.
        basis: inherent.basis,
      },
    });
  } catch (err) {
    logger.error({ event: "vendor_engagement_create_failed", organizationId, err }, "Engagement create failed");
    res.status(500).json({ error: "engagement_create_failed" });
  }
}

/* =========================================================
   GET /api/vendor-engagements — the reviewer's queue.
   ========================================================= */
export async function listEngagements(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const status = typeof req.query.status === "string" ? req.query.status : null;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);

  try {
    const result = await pg.query(
      `SELECT e.id, e.status, e.title, e.engagement_type,
              e.inherent_score, e.inherent_rating, e.assessment_tier,
              e.residual_score, e.residual_rating, e.residual_computed_at,
              e.decision, e.decided_at, e.next_review_due,
              e.analysis_coverage,
              -- The monitoring sweeps' queue signals: a review past its date,
              -- and an intelligence-triggered reassessment recommendation.
              (e.status = 'monitoring' AND e.next_review_due < CURRENT_DATE) AS review_overdue,
              e.reassessment_recommended_at,
              v.id AS vendor_id, v.name AS vendor_name,
              e.created_at, e.updated_at
         FROM vendor_engagements e
         JOIN vendors v ON v.id = e.vendor_id
        WHERE e.organization_id = $1
          AND ($2::text IS NULL OR e.status = $2)
        ORDER BY
          -- Highest residual first, then highest inherent for engagements that
          -- have not been scored yet. A queue ordered by date buries the vendor
          -- that matters under the vendor that arrived most recently.
          COALESCE(e.residual_score, e.inherent_score, 0) DESC,
          e.created_at DESC
        LIMIT $3`,
      [organizationId, status, limit]
    );

    res.status(200).json({ engagements: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error({ event: "vendor_engagement_list_failed", organizationId, err }, "Engagement list failed");
    res.status(500).json({ error: "engagement_list_failed" });
  }
}

/* =========================================================
   GET /api/vendor-engagements/:id — the full record.
   ========================================================= */
export async function getEngagement(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const result = await pg.query(
      // VA-C1 / owner ruling 2026-08-23: the ENDURING vendor-level criticality
      // travels with the engagement read so a reviewer can see it beside this
      // engagement's assessment_tier. They are different concepts — the
      // organisation's standing view of the relationship versus the depth of
      // one assessment — and until now only the second reached this surface,
      // which is how two ideas quietly become one.
      `SELECT e.*, v.name AS vendor_name, v.criticality AS vendor_criticality
         FROM vendor_engagements e
         JOIN vendors v ON v.id = e.vendor_id
        WHERE e.id = $1 AND e.organization_id = $2
        LIMIT 1`,
      [id, organizationId]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }

    const scope = await pg.query<{ n: string; answered: string; mandatory: string }>(
      `SELECT COUNT(*)::text AS n,
              COUNT(rr.status)::text AS answered,
              COUNT(*) FILTER (WHERE si.mandatory)::text AS mandatory
         FROM vendor_engagement_scope_items si
         LEFT JOIN requirement_responses rr
                ON rr.requirement_id = si.requirement_id
               AND rr.engagement_id  = si.engagement_id
               AND rr.organization_id = si.organization_id
        WHERE si.engagement_id = $1 AND si.organization_id = $2`,
      [id, organizationId]
    );

    // The engagement view previously said nothing about findings at all — so
    // it could assert "this control passes" while the finding it once
    // promoted stayed open, with the divergence visible nowhere. Derived
    // fresh on every read (the supersede-on-pass ruling, 2026-08-22): counts
    // plus the named list of open findings whose controls no longer assert a
    // gap. Nothing here transitions anything.
    const findingsSummary = await pg.query<{ total: string; open: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE ${sqlFindingActive("operational_status")})::text AS open
         FROM findings
        WHERE organization_id = $2 AND source_type = 'vendor_engagement' AND source_id = $1`,
      [id, organizationId]
    );
    const observation = await listFindingsSupersededBySource(organizationId, id);

    // VA-L1: the customer can finally see whether the vendor ever opened the
    // link. Metadata only — token material never leaves the invites table.
    const inviteRows = await pg.query<InviteStatusRow>(
      `SELECT ${INVITE_STATUS_SELECT}
         FROM vendor_engagement_invites
        WHERE engagement_id = $1 AND organization_id = $2
        ORDER BY created_at DESC`,
      [id, organizationId]
    );
    const activeInvite =
      inviteRows.rows.find(
        (r) => r.revoked_at === null && new Date(r.expires_at).getTime() > Date.now()
      ) ?? null;

    res.status(200).json({
      engagement: result.rows[0],
      invite: {
        active: activeInvite,
        latest: inviteRows.rows[0] ?? null,
        history_count: inviteRows.rowCount,
      },
      questionnaire: {
        scoped: Number(scope.rows[0]?.n ?? "0"),
        answered: Number(scope.rows[0]?.answered ?? "0"),
        mandatory: Number(scope.rows[0]?.mandatory ?? "0"),
      },
      findings: {
        total: Number(findingsSummary.rows[0]?.total ?? "0"),
        open: Number(findingsSummary.rows[0]?.open ?? "0"),
        superseded_by_source: observation.superseded,
        supersede_equivalence_undetermined: {
          count: observation.equivalence_undetermined.length,
          finding_ids: observation.equivalence_undetermined,
        },
      },
    });
  } catch (err) {
    logger.error({ event: "vendor_engagement_get_failed", organizationId, err }, "Engagement read failed");
    res.status(500).json({ error: "engagement_read_failed" });
  }
}

/* =========================================================
   PATCH /api/vendor-engagements/:id/inherent — reviewer override.

   Rating over score: the reviewer's band becomes authoritative, the arithmetic
   band is retained, and the SCORE is left untouched. Overwriting the score to
   match the band would destroy the divergence the override exists to express.
   ========================================================= */
export async function overrideInherent(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rating = typeof body.rating === "string" ? body.rating : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";

  if (!(RISK_BANDS as readonly string[]).includes(rating)) {
    res.status(400).json({ error: "invalid_rating", allowed: RISK_BANDS });
    return;
  }
  // A high-impact governance action carries its reason or it does not happen.
  if (rationale.length < 10) {
    res.status(400).json({
      error: "rationale_required",
      message: "Explain why the calculated rating is wrong. This is recorded against the engagement.",
    });
    return;
  }

  try {
    const current = await pg.query<{ status: string; inherent_rating: string | null }>(
      `SELECT status, inherent_rating FROM vendor_engagements
        WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (current.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const state = current.rows[0]!.status as EngagementState;

    // The tier derives from inherent and the frozen scope derives from the tier.
    // Changing inherent after issue would leave a questionnaire that no longer
    // matches the assessment it belongs to.
    if (!isInherentOverridable(state)) {
      res.status(409).json({
        error: "inherent_locked",
        message: "Inherent risk cannot change once the questionnaire has been issued — the scope derives from it.",
        status: state,
      });
      return;
    }

    await pg.query(
      `UPDATE vendor_engagements
          SET inherent_rating = $3, inherent_override_rationale = $4,
              inherent_overridden_by_user_id = $5, inherent_overridden_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [id, organizationId, rating, rationale, userOf(req)]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.inherent_overridden",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: { from: current.rows[0]!.inherent_rating, to: rating, rationale },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true, inherent_rating: rating });
  } catch (err) {
    logger.error({ event: "vendor_inherent_override_failed", organizationId, err }, "Inherent override failed");
    res.status(500).json({ error: "override_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/scope — resolve and FREEZE.

   Written once. The vendor's answers are only meaningful against the questions
   they were actually asked, so a re-resolve against today's corpus would
   silently reinterpret an assessment that already happened.
   ========================================================= */
export async function resolveScope(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query<Record<string, string | null>>(
      `SELECT status, assessment_tier, data_sensitivity, data_volume_band, access_level,
              operational_dependency, recoverability, business_criticality,
              regulatory_exposure, regulatory_breach_notification,
              ai_involvement, ai_autonomy, hosting_model,
              fourth_party_exposure, concentration_snapshot
         FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const row = eng.rows[0]! as Record<string, unknown>;
    const state = row.status as EngagementState;

    if (!isScopeMutable(state)) {
      res.status(409).json({
        error: "scope_frozen",
        message: "The questionnaire has been issued. Its scope is frozen — a vendor's answers are only meaningful against the questions they were asked.",
        status: state,
      });
      return;
    }

    // Requirements of every ACTIVATED framework, with their applicability tags.
    const requirements = await pg.query<{
      requirement_id: string;
      framework_id: string;
      reference_id: string;
      title: string;
      scope_tags: string[];
    }>(
      `SELECT r.id AS requirement_id, r.framework_id, r.reference_id, r.title,
              COALESCE(r.scope_tags, '{}') AS scope_tags
         FROM requirements r
         JOIN frameworks f ON f.id = r.framework_id
        WHERE f.organization_id = $1`,
      [organizationId]
    );

    // Obligation edges for ACTIVE obligations only — the filtering is this
    // caller's job, per the resolver's contract.
    const edges = await pg.query<{
      obligation_id: string;
      obligation_title: string;
      requirement_id: string;
    }>(
      `SELECT om.obligation_id, o.title AS obligation_title, om.requirement_id
         FROM obligation_mappings om
         JOIN obligations o ON o.id = om.obligation_id
        WHERE o.organization_id = $1
          AND COALESCE(o.status, 'active') = 'active'`,
      [organizationId]
    );

    const resolution = resolveEngagementScope({
      tier: row.assessment_tier as never,
      // The column names differ from the model's field names in two places
      // (`data_volume_band`, `concentration_snapshot`) because the spine named
      // them for what they are: a band, and a point-in-time snapshot taken so a
      // historical assessment stays reproducible.
      inherent: {
        data_sensitivity: row.data_sensitivity,
        data_volume: row.data_volume_band,
        access_level: row.access_level,
        operational_dependency: row.operational_dependency,
        recoverability: row.recoverability,
        business_criticality: row.business_criticality,
        regulatory_exposure: row.regulatory_exposure,
        regulatory_breach_notification: row.regulatory_breach_notification === true,
        ai_involvement: row.ai_involvement,
        ai_autonomy: row.ai_autonomy,
        hosting_model: row.hosting_model,
        fourth_party_exposure: row.fourth_party_exposure,
        concentration: row.concentration_snapshot,
      } as never,
      requirements: requirements.rows,
      obligationEdges: edges.rows,
    });

    // Freeze. Delete-then-insert inside the one tenant transaction the asTenant
    // wrap already holds, so a re-resolve before issue replaces cleanly and a
    // failure leaves the previous scope intact.
    await pg.query(
      `DELETE FROM vendor_engagement_scope_items WHERE engagement_id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    for (const item of resolution.items) {
      await pg.query(
        `INSERT INTO vendor_engagement_scope_items
           (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          organizationId,
          id,
          item.requirement_id,
          item.depth,
          item.mandatory,
          item.source,
          JSON.stringify(item.reasons),
        ]
      );
    }

    await pg.query(
      `UPDATE vendor_engagements
          SET status = 'scoped', scope_resolved_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.scope_resolved",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        item_count: resolution.items.length,
        excluded_count: resolution.excluded.length,
        scope_rule_version: resolution.scope_rule_version,
        tier: resolution.tier,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      scoped: resolution.items.length,
      excluded: resolution.excluded.length,
      tier: resolution.tier,
      scope_rule_version: resolution.scope_rule_version,
      // Caps are surfaced, never silent — a truncated questionnaire that looks
      // complete is the failure this field exists to prevent.
      notes: (resolution as { notes?: unknown }).notes ?? null,
    });
  } catch (err) {
    logger.error({ event: "vendor_scope_resolve_failed", organizationId, err }, "Scope resolve failed");
    res.status(500).json({ error: "scope_resolve_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/issue — mint the portal invite.

   Returns the RAW token exactly once. It is never stored and never readable
   again — only its SHA-256 is persisted, so a database read cannot reconstruct
   a working vendor credential.
   ========================================================= */

/* =========================================================
   VA-C1 — who the invitation is actually for.

   A credential may be addressed either to a KNOWN PERSON at the supplier
   (contact_id, the intended path now that vendors have a contact directory) or
   to a raw address (contact_email, still supported: a customer chasing an
   assessment at 6pm should not have to create a directory entry first).

   Either way the invite keeps its own contact_email/contact_name SNAPSHOT.
   That snapshot is the historical record of who we mailed at the address we
   used, and editing the contact row two years later must not rewrite it.
   ========================================================= */

type InviteAddressee = {
  email: string;
  name: string | null;
  contactId: string | null;
};

async function resolveInviteAddressee(
  organizationId: string,
  engagementId: string,
  body: Record<string, unknown>
): Promise<
  | { ok: true; addressee: InviteAddressee }
  | { ok: false; status: number; error: string; message?: string }
> {
  const contactId = typeof body.contact_id === "string" ? body.contact_id.trim() : "";
  if (contactId) {
    const vendor = await pg.query<{ vendor_id: string }>(
      `SELECT vendor_id FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [engagementId, organizationId]
    );
    const vendorId = vendor.rows[0]?.vendor_id;
    if (!vendorId) return { ok: false, status: 404, error: "engagement_not_found" };

    // Scoped to THIS engagement's vendor: a contact id belonging to another
    // supplier of the same customer must not be addressable here, and must not
    // be distinguishable from one that does not exist.
    const contact: VendorContactRow | null = await resolveVendorContact(
      organizationId,
      vendorId,
      contactId
    );
    if (!contact) return { ok: false, status: 404, error: "contact_not_found" };
    if (contact.status !== "active") {
      return {
        ok: false,
        status: 409,
        error: "contact_inactive",
        message: "That contact is marked inactive. Reactivate them or choose someone else.",
      };
    }
    return {
      ok: true,
      addressee: { email: contact.email, name: contact.full_name, contactId: contact.id },
    };
  }

  const email = typeof body.contact_email === "string" ? body.contact_email.trim() : "";
  const name = typeof body.contact_name === "string" ? body.contact_name.trim() : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, status: 400, error: "valid_contact_email_required" };
  }
  return { ok: true, addressee: { email, name: name || null, contactId: null } };
}

export async function issueEngagement(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    // VA-C1: a contact id names a person in the supplier's directory; a raw
    // address still works. Either way the invite snapshots what we mailed.
    const addressee = await resolveInviteAddressee(organizationId, id, body);
    if (!addressee.ok) {
      res.status(addressee.status).json(
        addressee.message
          ? { error: addressee.error, message: addressee.message }
          : { error: addressee.error }
      );
      return;
    }
    const { email, name, contactId } = addressee.addressee;

    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;

    const check = canTransition(from, "issued", "internal");
    if (!check.allowed) {
      res.status(409).json({
        error: "cannot_issue",
        from,
        reason: check.reason,
        // The overwhelmingly common cause is `draft` — the scope has not been
        // resolved yet, and resolving it is what moves the engagement to
        // `scoped`. Saying only "cannot issue from draft" is accurate and
        // leaves the reviewer to work out what to do about it.
        message:
          from === "draft" || from === "scoping"
            ? "Resolve the questionnaire scope first — that is what makes an engagement issuable."
            : "This engagement is not in a state that can be issued.",
      });
      return;
    }

    // Guard: issuing an empty questionnaire would send a vendor a link to
    // nothing and read, later, as a vendor who answered everything.
    const scoped = await pg.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_engagement_scope_items
        WHERE engagement_id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    if (Number(scoped.rows[0]?.n ?? "0") === 0) {
      res.status(422).json({
        error: "empty_scope",
        message: "Resolve the questionnaire scope before issuing. An empty questionnaire would return a complete-looking result with no content.",
      });
      return;
    }

    const invite = mintInviteToken();

    // Elevated: the invite is the credential a not-yet-authenticated external
    // party will present, and its lookup at exchange time necessarily precedes
    // org context. Written on the same channel that will read it.
    await pgElevated.query(
      `INSERT INTO vendor_engagement_invites
         (organization_id, engagement_id, invite_token_hash, contact_email, contact_name,
          expires_at, created_by_user_id, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [organizationId, id, invite.tokenHash, email, name, invite.expiresAt, userOf(req), contactId]
    );

    await pg.query(
      `UPDATE vendor_engagements
          SET status = 'issued', issued_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = $3`,
      [id, organizationId, from]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.issued",
      resourceType: "vendor_engagement",
      resourceId: id,
      // The token is NEVER in the audit payload. An audit log readable by more
      // people than the vendor's mailbox must not contain a working credential.
      payload: {
        contact_email: email,
        contact_id: contactId,
        expires_at: invite.expiresAt.toISOString(),
      },
      ipAddress: req.ip ?? null,
    });

    // VA-L1: actually deliver the link. Before this the route's own comments
    // claimed email delivery while no send site existed — the customer mailed
    // the credential themselves. The copy-link box REMAINS the fallback path:
    // a failed or disabled send never strands the issue.
    const orgName = await pg.query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
      [organizationId]
    );
    const emailDelivery = await sendVendorInviteEmail({
      contactEmail: email,
      contactName: name,
      organizationName: orgName.rows[0]?.name ?? "Your customer",
      rawToken: invite.token,
      expiresAt: invite.expiresAt,
    });

    res.status(200).json({
      ok: true,
      status: "issued",
      // Returned ONCE. Only the hash is stored.
      invite_token: invite.token,
      expires_at: invite.expiresAt,
      // "sent" | "failed" | "disabled" — the customer is told the truth about
      // whether anything left the building, so the copy box is never a guess.
      email_delivery: emailDelivery,
    });
  } catch (err) {
    logger.error({ event: "vendor_engagement_issue_failed", organizationId, err }, "Engagement issue failed");
    res.status(500).json({ error: "issue_failed" });
  }
}

/* =========================================================
   Invite lifecycle (VA-L1, authorized 2026-08-23).

   Until now the invite had a birth and nothing else: no route ever set the
   revocation columns 20260923 shipped, nothing read the invites table back
   to the customer, and a 30-day expiry stranded the engagement because
   `scoped → issued` is one-shot. Three operational dead ends, closed here.

   Owner ruling (revocation): ACCESS IS REVOKED, HISTORY IS PRESERVED.
   Revoking kills the invite AND its live sessions (the session store and
   middleware already support it — revoked_at is checked on every request),
   and touches nothing else: responses, revisions, evidence, comments and
   audit rows all stay exactly as they were, still attributed to the invite
   id they were made under.
   ========================================================= */

type InviteStatusRow = {
  id: string;
  contact_email: string;
  contact_name: string | null;
  /** VA-C1: the directory person this went to, or null for a raw address. */
  contact_id: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  first_exchanged_at: string | null;
  last_exchanged_at: string | null;
  exchange_count: number;
};

/** The customer-visible invite record. NEVER includes token material. */
const INVITE_STATUS_SELECT = `
  id, contact_email, contact_name, contact_id, created_at, expires_at, revoked_at,
  first_exchanged_at, last_exchanged_at, exchange_count`;

export async function revokeEngagementInvite(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  // The schema's CHECK requires a non-empty reason whenever revoked_at is set
  // (20260923), and the UI marks the reason optional — so an omitted reason
  // gets the honest default rather than a 23514 the customer cannot act on.
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : "revoked by customer";

  try {
    const eng = await pg.query<{ id: string }>(
      `SELECT id FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }

    const revoked = await pg.query<{ id: string }>(
      `UPDATE vendor_engagement_invites
          SET revoked_at = NOW(), revoked_by_user_id = $3, revocation_reason = $4
        WHERE engagement_id = $1 AND organization_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [id, organizationId, userOf(req), reason]
    );
    if (revoked.rowCount === 0) {
      res.status(404).json({ error: "no_active_invite" });
      return;
    }

    // Ruling: revocation terminates FUTURE access — including sessions already
    // minted from the invite. The portal middleware checks session revocation
    // on every request, so this is immediate, not eventual.
    const sessions = await pg.query<{ id: string }>(
      `UPDATE vendor_portal_sessions
          SET revoked_at = NOW()
        WHERE invite_id = ANY($1::uuid[]) AND organization_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [revoked.rows.map((r) => r.id), organizationId]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.invite_revoked",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        invites_revoked: revoked.rowCount,
        sessions_revoked: sessions.rowCount,
        reason,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      ok: true,
      invites_revoked: revoked.rowCount,
      sessions_revoked: sessions.rowCount,
    });
  } catch (err) {
    logger.error({ event: "invite_revoke_failed", organizationId, err }, "Invite revoke failed");
    res.status(500).json({ error: "invite_revoke_failed" });
  }
}

export async function reissueEngagementInvite(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    // VA-C1: same addressee rules as issue — a directory contact, or a raw
    // address. Re-issuing to a DIFFERENT person is legitimate and common (the
    // original contact left), which is why this is not pinned to the prior
    // invite's addressee.
    const addressee = await resolveInviteAddressee(organizationId, id, body);
    if (!addressee.ok) {
      res.status(addressee.status === 400 ? 400 : addressee.status).json(
        addressee.message
          ? { error: addressee.error === "valid_contact_email_required" ? "invalid_contact_email" : addressee.error, message: addressee.message }
          : { error: addressee.error === "valid_contact_email_required" ? "invalid_contact_email" : addressee.error }
      );
      return;
    }
    const { email, name, contactId } = addressee.addressee;

    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;
    // Re-issue replaces the credential for an ALREADY-ISSUED engagement — the
    // recovery valve for an expired or revoked link (and the "resend" path,
    // since only a hash survives issuance: resending means re-minting). A
    // never-issued engagement still uses /issue; a submitted one has nothing
    // for a vendor to do with a link.
    if (!["issued", "in_progress", "clarification_requested"].includes(from)) {
      res.status(409).json({
        error: "cannot_reissue",
        from,
        message:
          from === "draft" || from === "scoping" || from === "scoped"
            ? "This engagement has not been issued yet — use issue."
            : "The questionnaire is no longer open for vendor work — a new link would have nothing to do.",
      });
      return;
    }

    // Single-active-invite rule: the old credential (and its live sessions)
    // die when the replacement is born. History stays.
    const priorInvites = await pg.query<{ id: string }>(
      `UPDATE vendor_engagement_invites
          SET revoked_at = NOW(), revoked_by_user_id = $3,
              revocation_reason = 'superseded by re-issue'
        WHERE engagement_id = $1 AND organization_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [id, organizationId, userOf(req)]
    );
    if ((priorInvites.rowCount ?? 0) > 0) {
      await pg.query(
        `UPDATE vendor_portal_sessions
            SET revoked_at = NOW()
          WHERE invite_id = ANY($1::uuid[]) AND organization_id = $2 AND revoked_at IS NULL`,
        [priorInvites.rows.map((r) => r.id), organizationId]
      );
    }

    const invite = mintInviteToken();
    await pgElevated.query(
      `INSERT INTO vendor_engagement_invites
         (organization_id, engagement_id, invite_token_hash, contact_email, contact_name,
          expires_at, created_by_user_id, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [organizationId, id, invite.tokenHash, email, name, invite.expiresAt, userOf(req), contactId]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.invite_reissued",
      resourceType: "vendor_engagement",
      resourceId: id,
      // Token NEVER in the payload — same rule as issue.
      payload: {
        contact_email: email,
        contact_id: contactId,
        expires_at: invite.expiresAt.toISOString(),
        prior_invites_revoked: priorInvites.rowCount,
      },
      ipAddress: req.ip ?? null,
    });

    const orgName = await pg.query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
      [organizationId]
    );
    const emailDelivery = await sendVendorInviteEmail({
      contactEmail: email,
      contactName: name,
      organizationName: orgName.rows[0]?.name ?? "Your customer",
      rawToken: invite.token,
      expiresAt: invite.expiresAt,
    });

    res.status(200).json({
      ok: true,
      // Returned ONCE, same contract as issue.
      invite_token: invite.token,
      expires_at: invite.expiresAt,
      prior_invites_revoked: priorInvites.rowCount,
      email_delivery: emailDelivery,
    });
  } catch (err) {
    logger.error({ event: "invite_reissue_failed", organizationId, err }, "Invite re-issue failed");
    res.status(500).json({ error: "invite_reissue_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/recompute — effectiveness + residual.

   Reads the vendor's structured answers and their evidence, derives the
   assurance rung from OBSERVABLE FACTS, and persists both scores with their
   bases. Never called from a read path.
   ========================================================= */
export async function recomputeRisk(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query<{
      status: string;
      inherent_score: number | null;
      inherent_rating: string | null;
    }>(
      `SELECT status, inherent_score, inherent_rating
         FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    if (eng.rows[0]!.inherent_score === null) {
      res.status(409).json({ error: "inherent_not_computed" });
      return;
    }

    // One query joining scope, answers and evidence — the evidence COUNT per
    // requirement is what separates `asserted` from `documented`.
    const rows = await pg.query<{
      requirement_id: string;
      reference_id: string;
      depth: string;
      mandatory: boolean;
      status: string | null;
      evidence_count: string;
      evidence_confirmed: boolean;
    }>(
      `SELECT si.requirement_id, r.reference_id, si.depth, si.mandatory,
              rr.status,
              COUNT(ev.id)::text AS evidence_count,
              COALESCE(bool_or(ev.reviewed_at IS NOT NULL), FALSE) AS evidence_confirmed
         FROM vendor_engagement_scope_items si
         JOIN requirements r ON r.id = si.requirement_id
         LEFT JOIN requirement_responses rr
                ON rr.requirement_id = si.requirement_id
               AND rr.engagement_id  = si.engagement_id
               AND rr.organization_id = si.organization_id
         LEFT JOIN evidence ev
                ON ev.engagement_id   = si.engagement_id
               AND ev.requirement_id  = si.requirement_id
               AND ev.organization_id = si.organization_id
               AND ev.detached_at IS NULL
        WHERE si.engagement_id = $1 AND si.organization_id = $2
          AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
        GROUP BY si.requirement_id, r.reference_id, si.depth, si.mandatory, rr.status`,
      [id, organizationId]
    );

    const responses: ControlResponse[] = rows.rows.map((row) => {
      // An unanswered scope item is `not_assessed`, NOT absent. A control nobody
      // answered is a gap, and dropping it from the array would silently shrink
      // the denominator and improve the score.
      const status = (row.status ?? "not_assessed") as ResponseStatus;
      return {
        requirement_id: row.requirement_id,
        reference: row.reference_id,
        status,
        mandatory: row.mandatory,
        depth: row.depth,
        assurance: assuranceFor({
          status,
          evidenceCount: Number(row.evidence_count),
          evidenceConfirmed: row.evidence_confirmed,
          // Attestation-backed assurance requires an approved assurance report
          // covering this control. That linkage is Phase 4 work; until it lands
          // nothing reaches `attested`, which is the SAFE direction to be wrong.
          independentlyAttested: false,
        }),
      };
    });

    const effectiveness = computeControlEffectiveness(responses);

    const residual = computeResidualRisk({
      inherentScore: eng.rows[0]!.inherent_score!,
      ...(eng.rows[0]!.inherent_rating
        ? { inherentRating: eng.rows[0]!.inherent_rating as RiskBand }
        : {}),
      effectivenessScore: effectiveness.score,
      failedMandatoryCount: effectiveness.failed_mandatory_count,
      noEvidenceAtAll: responses.every((r) => r.assurance === "asserted" || r.assurance === "not_assessed"),
    });

    await pg.query(
      `UPDATE vendor_engagements
          SET residual_score = $3, residual_rating = $4, residual_basis = $5::jsonb,
              residual_computed_at = NOW(),
              effectiveness_score = $6, effectiveness_basis = $7::jsonb,
              -- The machine's one permitted advance: analysis_complete →
              -- decision_pending has actors internal|system and its guard
              -- (residual_computed) is satisfied by this very statement. Every
              -- other state is left exactly where the humans put it.
              status = CASE WHEN status = 'analysis_complete' THEN 'decision_pending' ELSE status END,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [
        id,
        organizationId,
        residual.score,
        residual.rating,
        JSON.stringify(residual.basis),
        effectiveness.score,
        JSON.stringify(effectiveness.basis),
      ]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.risk_recomputed",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        effectiveness_score: effectiveness.score,
        residual_score: residual.score,
        residual_rating: residual.rating,
        inherent_understated: residual.inherent_understated,
        methodology_version: METHODOLOGY_VERSION,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      effectiveness: {
        score: effectiveness.score,
        arithmetic_score: effectiveness.arithmetic_score,
        assessed: effectiveness.assessed_count,
        not_applicable: effectiveness.not_applicable_count,
        not_assessed: effectiveness.not_assessed_count,
        failed_mandatory: effectiveness.failed_mandatory_count,
        coverage: effectiveness.response_coverage,
        basis: effectiveness.basis,
      },
      residual: {
        score: residual.score,
        rating: residual.rating,
        arithmetic_score: residual.arithmetic_score,
        // Surfaced at the API boundary, not buried in the basis. Ratified: this
        // is one of the most informative signals the methodology produces.
        inherent_understated: residual.inherent_understated,
        basis: residual.basis,
      },
    });
  } catch (err) {
    logger.error({ event: "vendor_risk_recompute_failed", organizationId, err }, "Risk recompute failed");
    res.status(500).json({ error: "recompute_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/decision — the governance decision.

   RATIFIED: measurement and treatment stay separate. This route records what
   management chose. It does NOT touch residual_score or residual_rating, and
   there is no code path here that could.
   ========================================================= */
const DECISIONS = ["approved", "approved_with_conditions", "rejected", "terminated"];

export async function recordDecision(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = typeof body.decision === "string" ? body.decision : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";

  if (!DECISIONS.includes(decision)) {
    res.status(400).json({ error: "invalid_decision", allowed: DECISIONS });
    return;
  }
  if (rationale.length < 10) {
    res.status(400).json({
      error: "rationale_required",
      message: "A governance decision is recorded with its reasoning. This becomes part of the audit record.",
    });
    return;
  }

  try {
    const eng = await pg.query<{ status: string; residual_score: number | null; residual_rating: string | null }>(
      `SELECT status, residual_score, residual_rating
         FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;

    // A decision without a measurement is a decision about nothing.
    if (eng.rows[0]!.residual_score === null) {
      res.status(409).json({
        error: "residual_not_computed",
        message: "Residual risk must be computed before a decision is recorded.",
      });
      return;
    }

    const check = canTransition(from, "decided", "internal");
    if (!check.allowed) {
      res.status(409).json({ error: "cannot_decide", from, reason: check.reason });
      return;
    }

    const expires =
      typeof body.expires_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expires_at)
        ? body.expires_at
        : null;

    // Note what is ABSENT: residual_score and residual_rating are not in this
    // UPDATE. Accepting a risk does not make it smaller, and there is
    // deliberately no path here that could make it look smaller.
    await pg.query(
      `UPDATE vendor_engagements
          SET status = 'decided', decision = $3, decision_rationale = $4,
              decided_by_user_id = $5, decided_at = NOW(), decision_expires_at = $6,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = $7`,
      [id, organizationId, decision, rationale, userOf(req), expires, from]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.decided",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        decision,
        rationale,
        // The measurement the decision was made AGAINST, captured at the moment
        // of the decision. Someone reviewing this later must be able to see what
        // was known at the time, not what the number says today.
        residual_score_at_decision: eng.rows[0]!.residual_score,
        residual_rating_at_decision: eng.rows[0]!.residual_rating,
        expires_at: expires,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      ok: true,
      status: "decided",
      decision,
      // Echoed unchanged, so no caller can mistake the decision for a change in
      // the measurement.
      residual_score: eng.rows[0]!.residual_score,
      residual_rating: eng.rows[0]!.residual_rating,
    });
  } catch (err) {
    logger.error({ event: "vendor_decision_failed", organizationId, err }, "Decision record failed");
    res.status(500).json({ error: "decision_failed" });
  }
}

/* =========================================================
   GET /api/vendor-engagements/:id/evidence — what the vendor sent.

   The reviewer's side of the portal's metadata-only list. Unlike the vendor,
   the reviewer sees everything attached to the engagement, internal uploads
   included, and sees who supplied each file.
   ========================================================= */
export async function listEngagementEvidence(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const result = await pg.query(
      `SELECT e.id, e.title, e.original_filename, e.byte_size, e.mime_type,
              e.created_at, e.reviewed_at, e.review_note,
              e.requirement_id, r.reference_id AS requirement_reference, r.title AS requirement_title,
              -- Provenance: an invite means the VENDOR supplied it. A user means
              -- we did. Both are legitimate; conflating them is not.
              (e.uploaded_via_invite_id IS NOT NULL) AS from_vendor,
              e.uploaded_by_user_id,
              -- The analysis worker's ADVISORY verdict, if it has run. A
              -- suggestion for where to look first — the reviewed_at columns
              -- above remain the only thing the effectiveness ladder reads.
              a.verdict AS analysis_verdict,
              a.rationale AS analysis_rationale
         FROM evidence e
         LEFT JOIN requirements r ON r.id = e.requirement_id
         LEFT JOIN evidence_analysis a ON a.evidence_id = e.id
        WHERE e.organization_id = $1
          AND e.engagement_id   = $2
          AND e.detached_at IS NULL
        ORDER BY e.created_at ASC`,
      [organizationId, id]
    );
    res.status(200).json({ evidence: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error({ event: "engagement_evidence_list_failed", organizationId, err }, "Evidence list failed");
    res.status(500).json({ error: "evidence_list_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/evidence/:evidenceId/review

   The step the whole assurance ladder turns on: a human confirming that an
   attached document actually supports the claim it is attached to. That
   promotes the control from `documented` to `evidenced` — from "they attached
   something" to "somebody checked", which is most of what a vendor assurance
   programme is FOR.

   Deliberately never set by upload, and deliberately reversible: a reviewer who
   confirmed the wrong file must be able to withdraw the confirmation, and the
   score must move back.
   ========================================================= */
export async function reviewEvidence(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const engagementId = String(req.params["id"] ?? "");
  const evidenceId = String(req.params["evidenceId"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;

  // `supports` is REQUIRED and tri-state at the API even though it is boolean:
  // omitting it must not default to "yes". A confirmation nobody made is the
  // one thing this route must never produce.
  if (typeof body.supports !== "boolean") {
    res.status(400).json({
      error: "supports_required",
      message: "State explicitly whether this document supports the control it is attached to.",
    });
    return;
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;

  // Rejecting evidence carries a reason. "This does not support the claim" with
  // no explanation is not something a vendor can act on.
  if (body.supports === false && (!note || note.length < 5)) {
    res.status(400).json({
      error: "note_required",
      message: "Explain why this document does not support the control, so the vendor can supply something that does.",
    });
    return;
  }

  try {
    const updated = await pg.query<{ id: string; original_filename: string | null }>(
      `UPDATE evidence
          SET reviewed_at = CASE WHEN $4 THEN NOW() ELSE NULL END,
              reviewed_by_user_id = CASE WHEN $4 THEN $5::uuid ELSE NULL END,
              review_note = $6,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND engagement_id = $3
        RETURNING id, original_filename`,
      [evidenceId, organizationId, engagementId, body.supports, userOf(req), note]
    );
    if (updated.rowCount === 0) {
      // Scoped to the engagement, so a cross-engagement id is indistinguishable
      // from one that does not exist.
      res.status(404).json({ error: "evidence_not_found" });
      return;
    }

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: body.supports
        ? "vendor_engagement.evidence_confirmed"
        : "vendor_engagement.evidence_rejected",
      resourceType: "vendor_engagement",
      resourceId: engagementId,
      payload: {
        evidence_id: evidenceId,
        filename: updated.rows[0]!.original_filename,
        note,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      ok: true,
      reviewed: body.supports,
      // Recomputation is a separate, explicit call. A review silently changing
      // a stored risk rating is the kind of invisible mutation the methodology's
      // versioning rules exist to prevent.
      note: "Run /recompute to apply this to the effectiveness and residual scores.",
    });
  } catch (err) {
    logger.error({ event: "evidence_review_failed", organizationId, err }, "Evidence review failed");
    res.status(500).json({ error: "review_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/promote-findings

   Failed, partial and unanswered controls become canonical Findings — the
   object the rest of the platform already knows how to own, schedule, remediate
   and close.

   Idempotent by (engagement, requirement): re-running after a vendor revises an
   answer UPDATES the finding rather than creating a second one. Two findings for
   one control means closing one leaves the other open, and the vendor looks
   unremediated forever.
   ========================================================= */
export async function promoteEngagementFindings(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query<{
      inherent_rating: string | null;
      vendor_id: string;
      vendor_name: string;
    }>(
      `SELECT e.inherent_rating, e.vendor_id, v.name AS vendor_name
         FROM vendor_engagements e JOIN vendors v ON v.id = e.vendor_id
        WHERE e.id = $1 AND e.organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    if (!eng.rows[0]!.inherent_rating) {
      res.status(409).json({ error: "inherent_not_computed" });
      return;
    }

    const rows = await pg.query<{
      requirement_id: string;
      reference_id: string;
      title: string;
      mandatory: boolean;
      status: string | null;
      notes: string | null;
    }>(
      `SELECT si.requirement_id, r.reference_id, r.title, si.mandatory,
              rr.status, rr.notes
         FROM vendor_engagement_scope_items si
         JOIN requirements r ON r.id = si.requirement_id
         LEFT JOIN requirement_responses rr
                ON rr.requirement_id = si.requirement_id
               AND rr.engagement_id  = si.engagement_id
               AND rr.organization_id = si.organization_id
        WHERE si.engagement_id = $1 AND si.organization_id = $2
          AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)`,
      [id, organizationId]
    );

    const controls: PromotableControl[] = rows.rows.map((row) => ({
      requirement_id: row.requirement_id,
      reference: row.reference_id,
      title: row.title,
      // Unanswered is `not_assessed`, not absent — a mandatory control nobody
      // answered is a gap that must not vanish because only failures promote.
      status: (row.status ?? "not_assessed") as PromotableControl["status"],
      mandatory: row.mandatory,
      notes: row.notes,
    }));

    const findings = promoteFindings({
      controls,
      inherentBand: eng.rows[0]!.inherent_rating as never,
      vendorName: eng.rows[0]!.vendor_name,
    });

    let created = 0;
    let updated = 0;
    for (const finding of findings) {
      const result = await pg.query<{ inserted: boolean }>(
        `INSERT INTO findings
           (organization_id, source_type, source_id, requirement_id, title, description,
            recommendation, severity, severity_rationale, status, decision_state,
            operational_status, evidence_refs)
         VALUES ($1, 'vendor_engagement', $2, $3, $4, $5, $6, $7, $8,
                 'open', 'needs_review', 'open', '{}')
         ON CONFLICT (organization_id, source_id, requirement_id)
           WHERE source_type = 'vendor_engagement' AND requirement_id IS NOT NULL
         DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              recommendation = EXCLUDED.recommendation,
              severity = EXCLUDED.severity,
              severity_rationale = EXCLUDED.severity_rationale,
              updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [
          organizationId,
          id,
          finding.requirement_id,
          finding.title,
          finding.description,
          finding.recommendation,
          finding.severity,
          finding.severity_rationale,
        ]
      );
      if (result.rows[0]?.inserted) created += 1;
      else updated += 1;
    }

    // THE VENDOR'S RISK SCORE MUST MOVE WHEN A GAP IS RECORDED AGAINST IT.
    // Engagement promotion was — like CUEC promotion before it — a
    // vendor-finding-creating path that scheduled no recompute at all: with
    // the fourth linkage arm in place the resolver and the scoring query now
    // see these findings, but nothing would trigger them until some UNRELATED
    // finding on the same vendor changed state, which is indistinguishable
    // from "the gap does not count". The known-vendor variant is used because
    // the engagement row already carries vendor_id; fire-and-forget and
    // best-effort by contract, so a score refresh failure can never fail the
    // promotion. It defers with setImmediate and opens its OWN tenant scope,
    // so calling it inside this asTenant-wrapped handler runs it after the
    // request's tenant transaction has committed (A04-G1 γ.3) — the same
    // placement promoteVendorAssuranceCuecToFinding uses. Guarded on a
    // non-empty promotion because upserts are the only writes here: zero
    // promoted findings means zero score inputs changed.
    if (findings.length > 0) {
      scheduleVendorScoreRecompute(organizationId, eng.rows[0]!.vendor_id);
    }

    // Supersede-on-pass observation (ruled 2026-08-22): controls that now
    // report pass/not_applicable are ABSENT from the promoted set, so their
    // previously promoted findings would otherwise vanish from this summary
    // while staying open — and a resolution the summary hides is a resolution
    // nobody reviews. Name them; close nothing.
    const observation = await listFindingsSupersededBySource(organizationId, id);
    const superseded = observation.superseded;
    if (superseded.length > 0) {
      logger.info(
        {
          event: "vendor_engagement_findings_not_closed_on_pass",
          organizationId,
          engagementId: id,
          count: superseded.length,
        },
        `${superseded.length} open finding(s) NOT closed automatically — the source now reports pass/not_applicable for their controls; closure remains a human decision through the ordinary gate`
      );
    }

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.findings_promoted",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        created,
        updated,
        by_severity: findings.reduce<Record<string, number>>((acc, f) => {
          acc[f.severity] = (acc[f.severity] ?? 0) + 1;
          return acc;
        }, {}),
        // Capped so the payload stays operationally small; the full list is
        // in the response and derivable at any time.
        not_closed_superseded_by_source: {
          count: superseded.length,
          findings: superseded
            .slice(0, 20)
            .map((s) => ({ id: s.finding_id, current_response: s.current_response })),
        },
        supersede_equivalence_undetermined: {
          count: observation.equivalence_undetermined.length,
        },
        methodology_version: METHODOLOGY_VERSION,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      promoted: findings.length,
      created,
      updated,
      findings: findings.map((f) => ({
        reference: f.reference,
        severity: f.severity,
        title: f.title,
        severity_rationale: f.severity_rationale,
      })),
      superseded_by_source: superseded,
      supersede_equivalence_undetermined: {
        count: observation.equivalence_undetermined.length,
        finding_ids: observation.equivalence_undetermined,
      },
    });
  } catch (err) {
    logger.error({ event: "finding_promotion_failed", organizationId, err }, "Finding promotion failed");
    res.status(500).json({ error: "promotion_failed" });
  }
}

/* =========================================================
   GET  /api/vendor-engagements/:id/comments — the whole thread.
   POST /api/vendor-engagements/:id/comments — the reviewer's side.

   The internal half of the two-sided clarification thread. The portal writes
   `author_type='vendor', visibility='vendor'`; this surface writes
   `author_type='internal'` with the reviewer's choice of visibility —
   'internal' (reviewers only, never leaves this surface) or 'vendor' (a
   question TO the vendor).

   Posting a vendor-visible comment while the engagement is in_review IS the
   clarification request: it performs in_review → clarification_requested,
   whose guard (clarification_recorded) is satisfied by this very write. Without
   this route the transition was unreachable — a reviewer could not ask.
   ========================================================= */
export async function listEngagementComments(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  try {
    const result = await pg.query(
      `SELECT c.id, c.author_type, c.author_user_id, c.author_display_name,
              c.visibility, c.body, c.created_at,
              c.requirement_id, r.reference_id AS requirement_reference
         FROM vendor_engagement_comments c
         LEFT JOIN requirements r ON r.id = c.requirement_id
        WHERE c.organization_id = $1 AND c.engagement_id = $2
        ORDER BY c.created_at ASC, c.id ASC`,
      [organizationId, id]
    );
    res.status(200).json({ comments: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error({ event: "engagement_comments_list_failed", organizationId, err }, "Comment list failed");
    res.status(500).json({ error: "comments_list_failed" });
  }
}

export async function postEngagementComment(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length === 0 || text.length > 8000) {
    res.status(400).json({ error: "body_required", message: "A comment needs a body of at most 8000 characters." });
    return;
  }
  // Default INTERNAL: a note must be deliberately addressed to the vendor to
  // leave the authenticated surface. The safe direction needs no flag.
  const visibility = body.visibility === "vendor" ? "vendor" : "internal";
  const requirementId =
    typeof body.requirement_id === "string" && body.requirement_id.length > 0
      ? body.requirement_id
      : null;

  try {
    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;

    const ins = await pg.query<{ id: string }>(
      `INSERT INTO vendor_engagement_comments
         (organization_id, engagement_id, requirement_id, author_type, author_user_id, visibility, body)
       VALUES ($1, $2, $3, 'internal', $4, $5, $6)
       RETURNING id`,
      [organizationId, id, requirementId, userOf(req), visibility, text]
    );

    // A vendor-visible comment during review IS the clarification request.
    let newState: EngagementState | null = null;
    if (visibility === "vendor" && canTransition(from, "clarification_requested", "internal").allowed) {
      await pg.query(
        `UPDATE vendor_engagements SET status = 'clarification_requested', updated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND status = $3`,
        [id, organizationId, from]
      );
      newState = "clarification_requested";
    }

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType:
        newState === "clarification_requested"
          ? "vendor_engagement.clarification_requested"
          : "vendor_engagement.comment_posted",
      resourceType: "vendor_engagement",
      resourceId: id,
      // The body is NOT copied into the audit log — the row is the record.
      payload: { comment_id: ins.rows[0]!.id, visibility, requirement_id: requirementId },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({ id: ins.rows[0]!.id, visibility, status: newState ?? from });
  } catch (err) {
    logger.error({ event: "engagement_comment_post_failed", organizationId, err }, "Comment post failed");
    res.status(500).json({ error: "comment_post_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/begin-review — submitted → in_review.

   The reviewer opening the response. After this, portal writes are already
   refused (that happened at submit); this records that a human has the file.
   ========================================================= */
export async function beginReview(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;
    const check = canTransition(from, "in_review", "internal");
    if (!check.allowed) {
      res.status(409).json({ error: "cannot_begin_review", from, reason: check.reason });
      return;
    }

    await pg.query(
      `UPDATE vendor_engagements SET status = 'in_review', updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = $3`,
      [id, organizationId, from]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.review_started",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {},
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true, status: "in_review" });
  } catch (err) {
    logger.error({ event: "begin_review_failed", organizationId, err }, "Begin review failed");
    res.status(500).json({ error: "begin_review_failed" });
  }
}

/* =========================================================
   GET /api/vendor-engagements/:id/responses — the reviewer's view of the
   questionnaire itself (VA-R1, authorized 2026-08-23).

   Before this route the customer could see COUNTS ("7/12 answered"), scores,
   evidence rows and comments — but never the answers. The one hop named
   "review" contained no reviewable content: findings were promoted against
   aggregates. This is the read surface that makes the review workflow mean
   something.

   It is also the pre-issue answer to "what will my vendor be asked?" (owner
   ruling on derived scoping, 2026-08-23): for a scoped-but-unissued
   engagement every row simply carries response: null, so the same surface
   shows exactly what will be sent before any invitation exists. The scope
   population uses the SAME predicate as recompute and the portal
   questionnaire (deterministic OR accepted) — the reviewer reads the same
   questionnaire the vendor answers, never a superset and never a subset.

   Includes the first read surface over requirement_response_revisions —
   append-only since 20260924, durable but invisible until now. Revisions are
   capped per response and the cap is REPORTED (`truncated`), so a long edit
   history is elided loudly, never silently.
   ========================================================= */
const REVISIONS_PER_RESPONSE_CAP = 50;

export async function listEngagementResponses(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }

    const rows = await pg.query<{
      requirement_id: string;
      reference_id: string;
      title: string;
      description: string | null;
      depth: string;
      mandatory: boolean;
      response_id: string | null;
      status: string | null;
      notes: string | null;
      responder_type: string | null;
      answered_via_invite_id: string | null;
      assessed_by: string | null;
      assessed_at: string | null;
      updated_at: string | null;
      evidence_count: string;
      evidence_confirmed: boolean;
    }>(
      `SELECT si.requirement_id, r.reference_id, r.title, r.description,
              si.depth, si.mandatory,
              rr.id AS response_id, rr.status, rr.notes, rr.responder_type,
              rr.answered_via_invite_id, rr.assessed_by, rr.assessed_at, rr.updated_at,
              COUNT(ev.id)::text AS evidence_count,
              COALESCE(bool_or(ev.reviewed_at IS NOT NULL), FALSE) AS evidence_confirmed
         FROM vendor_engagement_scope_items si
         JOIN requirements r ON r.id = si.requirement_id
         LEFT JOIN requirement_responses rr
                ON rr.requirement_id  = si.requirement_id
               AND rr.engagement_id   = si.engagement_id
               AND rr.organization_id = si.organization_id
         LEFT JOIN evidence ev
                ON ev.engagement_id   = si.engagement_id
               AND ev.requirement_id  = si.requirement_id
               AND ev.organization_id = si.organization_id
               AND ev.detached_at IS NULL
        WHERE si.engagement_id = $1 AND si.organization_id = $2
          AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
        GROUP BY si.requirement_id, r.reference_id, r.title, r.description,
                 si.depth, si.mandatory,
                 rr.id, rr.status, rr.notes, rr.responder_type,
                 rr.answered_via_invite_id, rr.assessed_by, rr.assessed_at, rr.updated_at
        ORDER BY si.mandatory DESC, r.reference_id, si.requirement_id`,
      [id, organizationId]
    );

    // One pass for every revision of every response on this engagement. The
    // join re-checks the org on BOTH legs — the revision table is reachable
    // only through a same-org response row.
    const revisions = await pg.query<{
      response_id: string;
      status: string;
      notes: string | null;
      responder_type: string;
      answered_by_user_id: string | null;
      answered_via_invite_id: string | null;
      created_at: string;
    }>(
      `SELECT rev.response_id, rev.status, rev.notes, rev.responder_type,
              rev.answered_by_user_id, rev.answered_via_invite_id, rev.created_at
         FROM requirement_response_revisions rev
         JOIN requirement_responses rr
           ON rr.id = rev.response_id
          AND rr.organization_id = rev.organization_id
        WHERE rev.organization_id = $2 AND rr.engagement_id = $1
        ORDER BY rev.created_at ASC`,
      [id, organizationId]
    );
    const revisionsByResponse = new Map<string, typeof revisions.rows>();
    for (const rev of revisions.rows) {
      const list = revisionsByResponse.get(rev.response_id) ?? [];
      list.push(rev);
      revisionsByResponse.set(rev.response_id, list);
    }

    const items = rows.rows.map((row) => {
      const revs = row.response_id ? (revisionsByResponse.get(row.response_id) ?? []) : [];
      return {
        requirement: {
          id: row.requirement_id,
          reference: row.reference_id,
          title: row.title,
          description: row.description,
        },
        scope: { depth: row.depth, mandatory: row.mandatory },
        response:
          row.response_id === null
            ? null
            : {
                status: row.status,
                notes: row.notes,
                responder_type: row.responder_type,
                answered_via_invite_id: row.answered_via_invite_id,
                assessed_by_user_id: row.assessed_by,
                assessed_at: row.assessed_at,
                updated_at: row.updated_at,
              },
        evidence: {
          count: Number(row.evidence_count),
          confirmed: row.evidence_confirmed,
        },
        revisions: {
          total: revs.length,
          truncated: revs.length > REVISIONS_PER_RESPONSE_CAP,
          entries: revs.slice(-REVISIONS_PER_RESPONSE_CAP).map((rev) => ({
            status: rev.status,
            notes: rev.notes,
            responder_type: rev.responder_type,
            answered_by_user_id: rev.answered_by_user_id,
            answered_via_invite_id: rev.answered_via_invite_id,
            created_at: rev.created_at,
          })),
        },
      };
    });

    res.status(200).json({
      engagement_id: id,
      engagement_status: eng.rows[0]!.status,
      counts: {
        scoped: items.length,
        answered: items.filter((i) => i.response !== null).length,
        mandatory: items.filter((i) => i.scope.mandatory).length,
      },
      items,
    });
  } catch (err) {
    logger.error(
      { event: "engagement_responses_read_failed", organizationId, err },
      "Engagement responses read failed"
    );
    res.status(500).json({ error: "engagement_responses_read_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/complete-analysis — in_review → analysis_complete.

   Stamps `analysis_coverage` — the ratified record of whether AI-dependent
   analysis actually ran, so `deterministic_only` can never masquerade as a
   clean full analysis.

   The coverage value is COMPUTED, not accepted from the caller: it is a system
   observation about what ran, not an operator claim. It counts the
   evidence-analysis worker's recorded rows against the engagement's attached
   evidence: all analysed -> full, some -> partial, none (or no evidence) ->
   deterministic_only.
   ========================================================= */
export async function completeAnalysis(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;
    const check = canTransition(from, "analysis_complete", "internal");
    if (!check.allowed) {
      res.status(409).json({ error: "cannot_complete_analysis", from, reason: check.reason });
      return;
    }

    const counts = await pg.query<{ evidence_count: string; analyzed_count: string }>(
      `SELECT COUNT(e.id)::text AS evidence_count,
              COUNT(a.id)::text AS analyzed_count
         FROM evidence e
         LEFT JOIN evidence_analysis a ON a.evidence_id = e.id
        WHERE e.organization_id = $1 AND e.engagement_id = $2
          AND e.detached_at IS NULL AND e.storage_key IS NOT NULL`,
      [organizationId, id]
    );
    const coverage = computeAnalysisCoverage({
      evidenceCount: Number(counts.rows[0]?.evidence_count ?? "0"),
      analyzedCount: Number(counts.rows[0]?.analyzed_count ?? "0"),
    });

    await pg.query(
      `UPDATE vendor_engagements
          SET status = 'analysis_complete',
              analysis_coverage = $3, analysis_coverage_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = $4`,
      [id, organizationId, coverage, from]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.analysis_completed",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: { analysis_coverage: coverage },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true, status: "analysis_complete", analysis_coverage: coverage });
  } catch (err) {
    logger.error({ event: "complete_analysis_failed", organizationId, err }, "Complete analysis failed");
    res.status(500).json({ error: "complete_analysis_failed" });
  }
}

/* =========================================================
   POST /api/vendor-engagements/:id/monitoring

   Starts (or refreshes) continuous monitoring — the state a decided engagement
   lives in until its review comes due or the world changes.

   Two cases, one route:
     - from `decided`:    the state-machine transition, guarded on a review
                          date actually being set (`next_review_due_set`);
     - from `monitoring`: a cadence refresh — recording a completed periodic
                          review. No state transition; it re-arms both sweep
                          triggers by clearing their notification marks.

   The sweep worker (vendorAssuranceMonitoringWorker) only ever RECOMMENDS;
   this route is where a human sets the clock.
   ========================================================= */
export async function startMonitoring(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;

  // A review date is the whole point of the transition: monitoring with no
  // clock is `decided` wearing a different label.
  const cadence =
    typeof body.cadence_days === "number" && Number.isInteger(body.cadence_days)
      ? body.cadence_days
      : null;
  const explicitDue =
    typeof body.next_review_due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.next_review_due)
      ? body.next_review_due
      : null;
  if (!explicitDue && (cadence === null || cadence < 1 || cadence > 3650)) {
    res.status(400).json({
      error: "review_date_required",
      message:
        "Provide cadence_days (1-3650) or an explicit next_review_due date. Monitoring without a review date is not monitoring.",
    });
    return;
  }

  try {
    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;

    if (from !== "monitoring") {
      const check = canTransition(from, "monitoring", "internal");
      if (!check.allowed) {
        res.status(409).json({ error: "cannot_start_monitoring", from, reason: check.reason });
        return;
      }
    }

    const updated = await pg.query<{ next_review_due: string }>(
      `UPDATE vendor_engagements
          SET status = 'monitoring',
              next_review_due = COALESCE($3::date, CURRENT_DATE + make_interval(days => $4)),
              review_cadence_days = $4,
              -- Re-arm both sweep triggers: a fresh review date means the
              -- previous overdue/reassessment notifications are answered.
              review_overdue_notified_at = NULL,
              reassessment_recommended_at = NULL,
              reassessment_reason = NULL,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = $5
        RETURNING to_char(next_review_due, 'YYYY-MM-DD') AS next_review_due`,
      [id, organizationId, explicitDue, cadence, from]
    );
    if (updated.rowCount === 0) {
      // The status moved between read and write; the caller should re-read.
      res.status(409).json({ error: "engagement_state_changed" });
      return;
    }

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType:
        from === "monitoring"
          ? "vendor_engagement.monitoring_refreshed"
          : "vendor_engagement.monitoring_started",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        next_review_due: updated.rows[0]!.next_review_due,
        cadence_days: cadence,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      ok: true,
      status: "monitoring",
      next_review_due: updated.rows[0]!.next_review_due,
      cadence_days: cadence,
    });
  } catch (err) {
    logger.error({ event: "monitoring_start_failed", organizationId, err }, "Monitoring start failed");
    res.status(500).json({ error: "monitoring_start_failed" });
  }
}

// ---------------------------------------------------------------------------
// Router wiring — every route behind the same chain.
// ---------------------------------------------------------------------------

const chain = [
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
] as const;

router.post("/vendor-engagements", ...chain, asTenant(createEngagement));
router.get("/vendor-engagements", ...chain, asTenant(listEngagements));
router.get("/vendor-engagements/:id", ...chain, asTenant(getEngagement));
router.patch("/vendor-engagements/:id/inherent", ...chain, asTenant(overrideInherent));
router.post("/vendor-engagements/:id/scope", ...chain, asTenant(resolveScope));
router.post("/vendor-engagements/:id/recompute", ...chain, asTenant(recomputeRisk));
router.post("/vendor-engagements/:id/decision", ...chain, asTenant(recordDecision));
router.get("/vendor-engagements/:id/evidence", ...chain, asTenant(listEngagementEvidence));
router.get("/vendor-engagements/:id/responses", ...chain, asTenant(listEngagementResponses));
router.post("/vendor-engagements/:id/invite/revoke", ...chain, asTenant(revokeEngagementInvite));
router.post("/vendor-engagements/:id/invite/reissue", ...chain, asTenant(reissueEngagementInvite));
router.post(
  "/vendor-engagements/:id/evidence/:evidenceId/review",
  ...chain,
  asTenant(reviewEvidence)
);
router.post("/vendor-engagements/:id/promote-findings", ...chain, asTenant(promoteEngagementFindings));
router.get("/vendor-engagements/:id/comments", ...chain, asTenant(listEngagementComments));
router.post("/vendor-engagements/:id/comments", ...chain, asTenant(postEngagementComment));
router.post("/vendor-engagements/:id/begin-review", ...chain, asTenant(beginReview));
router.post("/vendor-engagements/:id/complete-analysis", ...chain, asTenant(completeAnalysis));
router.post("/vendor-engagements/:id/monitoring", ...chain, asTenant(startMonitoring));

// The issue route writes the invite on the ELEVATED channel (the credential is
// read before org context exists at exchange time), so it manages its own
// scoping rather than taking the asTenant wrap.
router.post("/vendor-engagements/:id/issue", ...chain, async (req: Request, res: Response) => {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  await withTenant(organizationId, () => issueEngagement(req, res));
});

export default router;
