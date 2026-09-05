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

import { pg, registerAfterCommit } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  ensureBridgeQuestions,
  loadQuestionSetItems,
  questionSetHash,
} from "../lib/questionnaire/bridgeQuestions.js";
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
import {
  resolveEngagementScopeWithApplicability,
  scopeVersionRunsCoreAssurance,
} from "../lib/vendorRisk/scopeResolver.js";
import { ensureCoreAssuranceSet } from "../lib/vendorRisk/coreAssuranceProvisioning.js";
import {
  buildCompositionSnapshot,
  loadLatestCompositionSnapshot,
  recordCompositionSnapshot,
} from "../lib/vendorRisk/compositionSnapshot.js";
import { resolveAssuranceCoverage, type AssuranceCoverage } from "../lib/vendorAssurance/assuranceCoverage.js";
import { evidenceLifecycleV2Enabled } from "../lib/evidenceLifecycleFlag.js";
import { recordApplicability } from "../lib/vendorRisk/applicabilityStore.js";
import { summarizeDomains } from "../lib/vendorRisk/requirementDomain.js";
import { resolveFacts } from "../lib/vendorRisk/factResolver.js";
import {
  FACT_ORIGINS,
  FACT_SOURCES,
  isFactOrigin,
  isFactSource,
  validateFact,
  type FactOrigin,
  type FactSource,
  type FactValidationError,
} from "../lib/vendorRisk/factRegistry.js";
import { resolveFactSubject } from "../lib/vendorRisk/factSubjects.js";
import {
  FactStoreValidationError,
  loadFactRows,
  mirrorSubjectFacts,
  writeFacts,
  type FactWrite,
  type StoredFactRow,
} from "../lib/vendorRisk/factStore.js";
import {
  assuranceFor,
  computeControlEffectiveness,
  type ControlResponse,
  type ResponseStatus,
} from "../lib/vendorRisk/controlEffectiveness.js";
import { computeResidualRisk } from "../lib/vendorRisk/residualRisk.js";
import { RISK_BANDS, type RiskBand, type AssessmentTier } from "../lib/vendorRisk/riskBands.js";
import {
  canTransition,
  isScopeMutable,
  isInherentOverridable,
  type EngagementState,
} from "../lib/vendorRisk/engagementStateMachine.js";
import { METHODOLOGY_VERSION, SCOPE_RULE_VERSION, INHERENT_METHODOLOGY_VERSION_V2 } from "../lib/vendorRisk/methodologyVersion.js";
import { v1FactsFromRelationship } from "../lib/vendorRisk/relationshipEngagementBridge.js";
import type { RelationshipIntakeFacts } from "../lib/vendorRisk/relationshipClassification.js";
import { promoteFindings, type PromotableControl } from "../lib/vendorRisk/findingPromotion.js";
import { resolveVendorContact, type VendorContactRow } from "./vendorContacts.js";
import { computeAnalysisCoverage } from "../lib/vendorRisk/analysisCoverage.js";
import { scheduleVendorScoreRecompute } from "../lib/vendorRiskScoreRecompute.js";
import { mintInviteToken } from "../lib/vendorPortal/portalTokens.js";
import { defaultInviteMessage, sendVendorInviteEmail } from "../lib/vendorPortal/inviteEmail.js";
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

/**
 * The methodology stamp an engagement was SCORED under. Audit payloads must
 * echo this, never the current constant: a VO2 engagement is stamped "2.0.0"
 * and labelling its events "1.0.0" would misdescribe how its rating was made.
 */
async function storedMethodologyVersion(organizationId: string, engagementId: string): Promise<string> {
  const r = await pg.query<{ methodology_version: string }>(
    `SELECT methodology_version FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [engagementId, organizationId]
  );
  return r.rows[0]?.methodology_version ?? METHODOLOGY_VERSION;
}

/* =========================================================
   Vendor Onboarding 2.0 (VO-7): opening an engagement FROM a relationship.

   When the body names a relationship_id, the customer is NOT asked the intake
   again. The engagement inherits the relationship's v2 classification — the
   inherent score/band/basis and the JOINT assessment tier — stamped "2.0.0",
   and its v1-vocabulary fact columns are populated through the scoping bridge
   so the existing scope resolver behaves unchanged. Nothing is rescored by v1.
   ========================================================= */
type RelationshipSeed = {
  relationshipId: string;
  facts: InherentRiskInput;
  inherent: { score: number; band: RiskBand; arithmetic_band: RiskBand; basis: unknown };
  tier: AssessmentTier;
};

async function seedFromRelationship(
  organizationId: string,
  vendorId: string,
  relationshipId: string
): Promise<{ ok: true; seed: RelationshipSeed } | { ok: false; status: number; error: string; message?: string }> {
  const rel = await pg.query<{
    id: string; assessment_tier: AssessmentTier | null; criticality_band: RiskBand | null;
    inherent_score: number | null; inherent_band: RiskBand | null; inherent_arithmetic_band: RiskBand | null;
    inherent_basis: unknown; classification_intake_id: string | null; status: string;
  }>(
    `SELECT id, status, assessment_tier, criticality_band, inherent_score, inherent_band,
            inherent_arithmetic_band, inherent_basis, classification_intake_id
       FROM vendor_relationships WHERE id = $1 AND organization_id = $2 AND vendor_id = $3 LIMIT 1`,
    [relationshipId, organizationId, vendorId]
  );
  const r = rel.rows[0];
  if (!r) return { ok: false, status: 404, error: "relationship_not_found" };
  if (r.status !== "active") return { ok: false, status: 409, error: "relationship_inactive" };
  if (!r.assessment_tier || !r.classification_intake_id || !r.criticality_band || r.inherent_score === null) {
    return {
      ok: false, status: 409, error: "intake_required",
      message: "This relationship has no factual intake yet, so it has no classification to assess against. Complete the intake first.",
    };
  }
  const intake = await pg.query<RelationshipIntakeFacts>(
    `SELECT max_tolerable_disruption, operational_dependency, business_reach, substitutability, process_coupling, concentration,
            data_sensitivity, data_volume, access_level, regulatory_exposure, regulatory_breach_notification,
            ai_involvement, ai_autonomy, hosting_model, fourth_party_exposure
       FROM vendor_relationship_intake WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [r.classification_intake_id, organizationId]
  );
  const facts = intake.rows[0];
  if (!facts) return { ok: false, status: 409, error: "intake_required" };
  return {
    ok: true,
    seed: {
      relationshipId: r.id,
      facts: v1FactsFromRelationship(facts, r.criticality_band),
      inherent: { score: r.inherent_score, band: r.inherent_band!, arithmetic_band: r.inherent_arithmetic_band!, basis: r.inherent_basis },
      tier: r.assessment_tier,
    },
  };
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

  const relationshipId = typeof body.relationship_id === "string" ? body.relationship_id.trim() : "";

  // Two ways in. The v1 path asks the twelve-field intake and scores it with
  // the v1 engine (methodology 1.0.0) — unchanged, still the path for
  // engagements not yet attached to a relationship. The VO2 path names a
  // relationship and inherits its classification.
  let scoring: { score: number; band: RiskBand; arithmetic_band: RiskBand; basis: unknown; tier: AssessmentTier };
  let facts: InherentRiskInput;
  let methodologyVersion: string;
  if (!relationshipId) {
    const intake = validateIntake(body.intake ?? body);
    if (!intake.ok) {
      // Deliberately explicit about WHICH fields. A generic 400 on a twelve-field
      // form is a support ticket.
      res.status(400).json(intake);
      return;
    }
    const inherent = computeVendorInherentRisk(intake.input);
    scoring = { score: inherent.score, band: inherent.band, arithmetic_band: inherent.arithmetic_band, basis: inherent.basis, tier: inherent.tier };
    facts = intake.input;
    methodologyVersion = METHODOLOGY_VERSION;
  } else {
    facts = undefined as never; scoring = undefined as never; methodologyVersion = ""; // assigned below inside try
  }

  try {
    const vendor = await pg.query<{ id: string; name: string }>(
      `SELECT id, name FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [vendorId, organizationId]
    );
    if (vendor.rowCount === 0) {
      res.status(404).json({ error: "vendor_not_found" });
      return;
    }

    if (relationshipId) {
      const seeded = await seedFromRelationship(organizationId, vendorId, relationshipId);
      if (!seeded.ok) {
        res.status(seeded.status).json(seeded.message ? { error: seeded.error, message: seeded.message } : { error: seeded.error });
        return;
      }
      facts = seeded.seed.facts;
      scoring = { ...seeded.seed.inherent, tier: seeded.seed.tier };
      methodologyVersion = INHERENT_METHODOLOGY_VERSION_V2;
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
          concentration_snapshot, concentration_snapshot_at, relationship_id)
       VALUES ($1, $2, $3, 'draft', $4,
               $5, $6, $7, $8::jsonb,
               $9, $10, $11, $12,
               $13, $14, $15, $16,
               $17, $18, $19,
               $20,
               $21, $22, $23, $24,
               $25, NOW(), $26)
       RETURNING id`,
      [
        organizationId,
        vendorId,
        engagementType,
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim().slice(0, 300)
          : `${vendor.rows[0]!.name} assurance review`,
        scoring.score,
        scoring.band,
        scoring.arithmetic_band,
        JSON.stringify(scoring.basis),
        scoring.tier,
        methodologyVersion,
        SCOPE_RULE_VERSION,
        userOf(req),
        facts.data_sensitivity,
        facts.data_volume,
        facts.access_level,
        facts.operational_dependency,
        facts.recoverability,
        facts.business_criticality,
        facts.regulatory_exposure,
        facts.regulatory_breach_notification,
        facts.ai_involvement,
        facts.ai_autonomy,
        facts.hosting_model,
        facts.fourth_party_exposure,
        facts.concentration,
        relationshipId || null,
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
        inherent_score: scoring.score,
        inherent_rating: scoring.band,
        tier: scoring.tier,
        methodology_version: methodologyVersion,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({
      id,
      status: "draft",
      inherent: {
        score: scoring.score,
        rating: scoring.band,
        arithmetic_rating: scoring.arithmetic_band,
        tier: scoring.tier,
        // The whole explanation travels with the number. A reviewer must never
        // have to re-derive anything to understand a rating.
        basis: scoring.basis,
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
      // VA-C1 / owner ruling 2026-08-23, reaffirmed by the Vendor Onboarding 2.0
      // methodology freeze: the ENDURING vendor-level criticality travels with
      // the engagement read so a reviewer can see it beside this engagement's
      // assessment_tier. They are different concepts — the organisation's
      // standing view of the relationship versus the depth of ONE assessment —
      // and until now only the second reached this surface, which is how two
      // ideas quietly become one.
      //
      // Under Onboarding 2.0 this column is the MANUAL legacy classification.
      // It is preserved with its provenance and is never overwritten by a
      // derived value; surfaces must label it as manually classified.
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

    // VA-Q2 P2: the questionnaire grouped by the domain each item was asked
    // under. Stamped at resolve for scope-rule 1.1.0+; a pre-Q2 engagement has
    // NULL on every item and reports `domains: null` rather than six zeros.
    const domainRows = await pg.query<{ domain: string | null }>(
      `SELECT domain FROM vendor_engagement_scope_items
        WHERE engagement_id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    const domains = summarizeDomains(domainRows.rows.map((r) => r.domain));

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

    // Vendor Onboarding 2.0 (VO-11): the relationship this engagement assesses,
    // with its STORED derived classification. Read, never recalculated — the
    // engine that produced these values stamped its version into the row, and
    // this surface only repeats what it recorded. NULL for engagements opened
    // before 2.0, which are honestly unlinked rather than backfilled.
    //
    // WA-2: the three BASIS envelopes now travel with it. They were withheld
    // here on the theory that "the vendor page owns the full basis", which in
    // practice meant an analyst looking at an engagement could see that it was
    // rated Critical but had to leave the engagement to find out why — and the
    // walkthrough found exactly that gap. The envelopes are already
    // tenant-visible by contract (methodologyVersion.ts: "this envelope is
    // TENANT-VISIBLE. Anything added to it must be safe to show the customer")
    // and are stored, versioned and immutable, so repeating them on a second
    // read surface adds a rendering, not a decision.
    const relationshipId = (result.rows[0] as { relationship_id?: string | null }).relationship_id ?? null;
    let relationship: Record<string, unknown> | null = null;
    if (relationshipId) {
      const rel = await pg.query(
        `SELECT id, name, service_description, is_primary, status, policy_minimum_tier,
                criticality_score, criticality_band, criticality_arithmetic_band, criticality_methodology_version,
                criticality_basis,
                inherent_score, inherent_band, inherent_arithmetic_band, inherent_methodology_version,
                inherent_basis,
                assessment_tier, tier_calculated_minimum, tier_methodology_version, tier_basis,
                classification_computed_at
           FROM vendor_relationships WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [relationshipId, organizationId]
      );
      relationship = rel.rows[0] ?? null;
    }

    // Goal §B: whether and how the invitation was delivered, and whether the
    // vendor ever opened it. Metadata only — token material never leaves the
    // invites table.
    const invite = await loadInviteStatus(organizationId, id);

    res.status(200).json({
      engagement: result.rows[0],
      relationship,
      invite,
      questionnaire: {
        scoped: Number(scope.rows[0]?.n ?? "0"),
        answered: Number(scope.rows[0]?.answered ?? "0"),
        mandatory: Number(scope.rows[0]?.mandatory ?? "0"),
        domains,
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

    // WA-2: this refusal used to say "the scope derives from it". Under
    // methodology 1.0.0 that was true. Under Vendor Onboarding 2.0 it is NOT:
    // the questionnaire is composed from `vendor_engagements.assessment_tier`
    // (the JOINT tier inherited from the relationship) and from the stored fact
    // columns — never from `inherent_rating`. See resolveScope, which reads
    // `row.assessment_tier` and builds `inherent` from the facts.
    //
    // What this override actually does today is change the band that
    // `promoteFindings` uses to set finding SEVERITY. That is worth having and
    // worth being honest about; telling an analyst it reshapes the
    // questionnaire would send them here expecting a different set of
    // questions and leave them wondering why nothing changed.
    //
    // The window is unchanged (scope-mutable states only): re-rating an
    // engagement after its answers exist would restate the severity of findings
    // against a questionnaire that was chosen under the old rating.
    if (!isInherentOverridable(state)) {
      res.status(409).json({
        error: "inherent_locked",
        message:
          "Inherent risk cannot be re-rated once the questionnaire has been issued. " +
          "It sets the severity of findings promoted from this assessment, and changing it now would restate findings against answers already given.",
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
      `SELECT status, assessment_tier, scope_rule_version,
              data_sensitivity, data_volume_band, access_level,
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

    // Assessment Composition v1: the STAMPED corpus decides whether the Core
    // Assurance Set is the baseline. At >= 1.2.0 the tenant's library must
    // hold the sixteen objectives before the resolver reads it — provisioned
    // lazily, idempotently, on this tenant connection. An engagement stamped
    // 1.1.0 or 1.0.0 neither provisions nor reads them.
    const stampedScopeRuleVersion =
      typeof row.scope_rule_version === "string" ? row.scope_rule_version : "1.0.0";
    if (scopeVersionRunsCoreAssurance(stampedScopeRuleVersion)) {
      await ensureCoreAssuranceSet(pg, organizationId);
    }

    // Requirements of every ACTIVATED framework, with their applicability tags
    // and the framework's canonical identity + display name (the snapshot
    // records what was composed BY VALUE).
    const requirements = await pg.query<{
      requirement_id: string;
      framework_id: string;
      reference_id: string;
      title: string;
      description: string | null;
      scope_tags: string[];
      framework_key: string | null;
      framework_name: string;
    }>(
      `SELECT r.id AS requirement_id, r.framework_id, r.reference_id, r.title, r.description,
              COALESCE(r.scope_tags, '{}') AS scope_tags,
              f.framework_key, f.name AS framework_name
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

    // The column names differ from the model's field names in two places
    // (`data_volume_band`, `concentration_snapshot`) because the spine named
    // them for what they are: a band, and a point-in-time snapshot taken so a
    // historical assessment stays reproducible.
    const inherent = {
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
      } as InherentRiskInput;

    // VA-Q2 P3: the resolver reads ONE fact surface — the canonical fact store.
    // The subject is obtained ONLY through the tenant-scoped resolver (D1
    // integrity layer 3); the mirrors (13 inputs, vendor-profile flags,
    // AI-system dependencies) are idempotent and run at every resolve while
    // the scope is mutable (checked above); then the ACCEPTED rows — mirrors
    // plus whatever `PUT /facts` declared — are resolved by precedence.
    const subject = await resolveFactSubject(pg, organizationId, "vendor_engagement", id);
    if (!subject) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    await mirrorSubjectFacts(pg, organizationId, subject, inherent);
    const factRows = await loadFactRows(pg, organizationId, subject, { statuses: ["accepted"] });

    // ── VA-S4 step 5 — governed assurance coverage ─────────────────────────
    //
    // DUAL-READ FIRST, AUTHORITY SECOND (ADR-0012 §5). The predicate is
    // computed on EVERY resolve and logged; it is APPLIED only behind
    // SECURELOGIC_EVIDENCE_LIFECYCLE_V2. While the flag is off the resolution
    // is byte-identical to pre-step-5 output — the legacy coverage source was
    // the empty set, so zero divergence means the log shows covered_count 0
    // until a human has actually curated, linked and determined sufficiency.
    // The audit event below persists the comparison, so the divergence record
    // survives log retention.
    //
    // FAIL-CLOSED, in the safe direction: a coverage failure yields NO
    // reduction — the vendor is asked in full, which is the pre-S4 behaviour,
    // never a crash and never a silent pass.
    let s4Coverage: AssuranceCoverage | null = null;
    try {
      s4Coverage = await resolveAssuranceCoverage({ organizationId, engagementId: id });
    } catch (err) {
      logger.error({ event: "s4_coverage_failed", engagementId: id, err },
        "S4 assurance coverage computation failed — resolving with no reduction");
    }
    const s4Applied = evidenceLifecycleV2Enabled(process.env) && s4Coverage !== null;
    if (s4Coverage) {
      logger.info({
        event: "s4_coverage_dual_read",
        engagementId: id,
        applied: s4Applied,
        covered_count: s4Coverage.covered.length,
        gap_count: s4Coverage.gaps.length,
        coverage_version: s4Coverage.version,
        as_of: s4Coverage.asOf,
      }, "S4 coverage dual-read");
    }
    const s4BasisByRequirement: Record<string, Record<string, unknown>> = {};
    if (s4Applied && s4Coverage) {
      for (const c of s4Coverage.covered) {
        s4BasisByRequirement[c.requirementId] = {
          determination_id: c.determinationId,
          document_id: c.documentId,
          valid_until: c.validUntil,
          validity_source: c.validitySource,
          report_period_end: c.reportPeriodEnd,
          assurance_class: c.assuranceClass,
          coverage_version: s4Coverage.version,
          as_of: s4Coverage.asOf,
        };
      }
    }

    const { resolution, applicability } = resolveEngagementScopeWithApplicability({
      tier: row.assessment_tier as never,
      inherent,
      facts: resolveFacts(factRows),
      // The STAMPED rule version is load-bearing (methodologyVersion.ts:
      // "recompute reads the stamped values"). An engagement stamped 1.0.0
      // re-resolves under 1.0.0 — S5 never runs for it — so a pre-Q2
      // questionnaire cannot change under a customer's feet.
      scopeRuleVersion: stampedScopeRuleVersion,
      requirements: requirements.rows,
      obligationEdges: edges.rows,
      ...(s4Applied && s4Coverage
        ? {
            assuranceCoveredRequirementIds: s4Coverage.covered.map((c) => c.requirementId),
            assuranceCoverageBasis: s4BasisByRequirement,
          }
        : {}),
    });

    // Freeze. Delete-then-insert inside the one tenant transaction the asTenant
    // wrap already holds, so a re-resolve before issue replaces cleanly and a
    // failure leaves the previous scope intact.
    await pg.query(
      `DELETE FROM vendor_engagement_scope_items WHERE engagement_id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    // VA-Q1 P2 (ADR-0013 R1/R3): every scope item is addressed by an IMMUTABLE
    // question version. Until the curated library covers a requirement, the
    // version is the requirement-as-question bridge — same text the vendor saw
    // before P2, now pinned so a later requirement edit cannot move under an
    // issued questionnaire. Ensured here, at composition, because requirement
    // inserts happen on three separate paths and hooking them cannot be
    // guaranteed complete.
    const byId = new Map(requirements.rows.map((r) => [r.requirement_id, r]));
    const chosen = resolution.items
      .map((i) => byId.get(i.requirement_id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    const versionByRequirement = await ensureBridgeQuestions(pg, organizationId, chosen);

    for (const item of resolution.items) {
      await pg.query(
        `INSERT INTO vendor_engagement_scope_items
           (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons,
            question_version_id, domain)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          organizationId,
          id,
          item.requirement_id,
          item.depth,
          item.mandatory,
          item.source,
          JSON.stringify(item.reasons),
          versionByRequirement.get(item.requirement_id) ?? null,
          // VA-Q2 P2: the domain the resolver asked this item under. Present
          // only when the STAMPED corpus is >= 1.1.0 (the resolver sets it
          // then and only then); a 1.0.0 engagement writes NULL — the stamp
          // records what was computed, never a domain nobody computed.
          item.domain ?? null,
        ]
      );
    }

    // #926: record WHAT APPLIED, independently of what composition kept. This
    // is written from `applicability`, which the resolver collected BEFORE
    // truncation — a rule whose every item was dropped is recorded here and
    // nowhere else. Idempotent by unique key, so a repeat resolve inserts 0.
    await recordApplicability(pg, {
      organizationId,
      engagementId: id,
      scopeRuleVersion: resolution.scope_rule_version,
      records: applicability,
    });

    // Assessment Composition v1: the customer-readable, immutable record of
    // what was composed and why — including what was NOT asked and on what
    // facts, which no other record carries. Written for every corpus version
    // (a 1.1.0 snapshot simply has no core_assurance block).
    const resolvedAt = new Date().toISOString();
    const compositionSnapshot = buildCompositionSnapshot({
      resolution,
      requirements: requirements.rows,
      coverage: {
        computed: s4Coverage !== null,
        applied: s4Applied,
        version: s4Coverage?.version ?? null,
        as_of: s4Coverage?.asOf ?? null,
        covered_count: s4Coverage?.covered.length ?? 0,
        gap_count: s4Coverage?.gaps.length ?? 0,
      },
      resolvedAt,
    });
    const snapshotRow = await recordCompositionSnapshot(pg, {
      organizationId,
      engagementId: id,
      snapshot: compositionSnapshot.snapshot,
      hash: compositionSnapshot.hash,
      createdByUserId: userOf(req),
    });

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
        // ADR-0012 §5: the dual-read comparison, PERSISTED — the divergence
        // evidence must outlive log retention. applied=false with a nonzero
        // covered_count is a divergence candidate to investigate before flip.
        s4_assurance: s4Coverage === null ? { computed: false } : {
          computed: true,
          applied: s4Applied,
          covered_count: s4Coverage.covered.length,
          gap_count: s4Coverage.gaps.length,
          coverage_version: s4Coverage.version,
          as_of: s4Coverage.asOf,
        },
        scope_rule_version: resolution.scope_rule_version,
        tier: resolution.tier,
        composition_snapshot_id: snapshotRow.id,
        composition_snapshot_hash: compositionSnapshot.hash,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      scoped: resolution.items.length,
      excluded: resolution.excluded.length,
      tier: resolution.tier,
      scope_rule_version: resolution.scope_rule_version,
      // Assessment Composition v1: the headline of what was composed, and the
      // snapshot to read for the whole explanation.
      composition_snapshot: {
        id: snapshotRow.id,
        hash: compositionSnapshot.hash,
        summary: compositionSnapshot.snapshot.summary,
      },
      // Caps are surfaced, never silent — a truncated questionnaire that looks
      // complete is the failure this field exists to prevent. (VA-6 repaired
      // this line: it previously read a `notes` field the resolver has never
      // had, so the tier cap was computed and then always reported as null.)
      truncated: resolution.truncated ?? null,
      // #922: how the questionnaire was composed against the tier's NOMINAL
      // target. `nominal_target` is a target, not a ceiling — the SecureLogic
      // assessment floor is satisfied first and is never truncated, so `total`
      // exceeds it whenever the floor alone does and `mandatory_overage` says
      // by how much. Absent for 1.0.0 resolutions, which keep frozen behaviour.
      composition: resolution.composition ?? null,
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

/**
 * The customer-visible invite record (goal §B). NEVER includes token material.
 * `message` is the customer's own text and `email_delivery_state` is what
 * SecureLogic did with it — both are theirs to see.
 */
const INVITE_STATUS_SELECT = `
  id, contact_id, contact_email, contact_name, message, due_date::text AS due_date,
  email_delivery_state, email_delivery_at, email_provider_message_id, email_delivery_detail,
  created_at, expires_at, revoked_at, revocation_reason,
  first_exchanged_at, last_exchanged_at, exchange_count`;

type InviteStatusRow = {
  id: string;
  contact_id: string | null;
  contact_email: string;
  contact_name: string | null;
  message: string | null;
  due_date: string | null;
  email_delivery_state: string;
  email_delivery_at: string | null;
  email_provider_message_id: string | null;
  email_delivery_detail: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  first_exchanged_at: string | null;
  last_exchanged_at: string | null;
  exchange_count: number;
};

async function loadInviteStatus(
  organizationId: string,
  engagementId: string
): Promise<{ active: InviteStatusRow | null; latest: InviteStatusRow | null; history_count: number }> {
  const rows = await pg.query<InviteStatusRow>(
    `SELECT ${INVITE_STATUS_SELECT}
       FROM vendor_engagement_invites
      WHERE engagement_id = $1 AND organization_id = $2
      ORDER BY created_at DESC`,
    [engagementId, organizationId]
  );
  const active =
    rows.rows.find((r) => r.revoked_at === null && new Date(r.expires_at).getTime() > Date.now()) ?? null;
  return { active, latest: rows.rows[0] ?? null, history_count: rows.rowCount ?? 0 };
}

/**
 * The invitation's COMPOSITION inputs (goal §B): the customer's message and
 * the requested due date. Both optional; the message defaults to the
 * professional template when omitted, and a due date must be a calendar date
 * that has not already passed.
 */
function parseInviteComposition(
  body: Record<string, unknown>
): { ok: true; message: string | null; dueDate: string | null; sendEmail: boolean } | { ok: false; error: string; message: string } {
  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
  if (rawMessage.length > 4000) {
    return { ok: false, error: "message_too_long", message: "Keep the invitation message under 4,000 characters." };
  }
  const rawDue = typeof body.due_date === "string" ? body.due_date.trim() : "";
  let dueDate: string | null = null;
  if (rawDue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDue) || Number.isNaN(new Date(`${rawDue}T00:00:00Z`).getTime())) {
      return { ok: false, error: "invalid_due_date", message: "The due date must be a calendar date (YYYY-MM-DD)." };
    }
    if (rawDue < new Date().toISOString().slice(0, 10)) {
      return { ok: false, error: "due_date_in_past", message: "The due date has already passed." };
    }
    dueDate = rawDue;
  }
  // Sending is the normal workflow; a caller must opt OUT to get a copy-link-only issue.
  const sendEmail = body.send_email !== false;
  return { ok: true, message: rawMessage || null, dueDate, sendEmail };
}

/**
 * Mint, store and (when asked) send one invitation for an engagement whose
 * transition has ALREADY been made by the caller inside the same tenant
 * transaction. Shared by issue and re-issue so the two can never drift.
 *
 * The send happens INSIDE the transaction, after the credential row exists.
 * If the send fails, the credential still stands and the row records the
 * failure (the customer resends or copies the link). If the transaction
 * later fails to commit — the only step after this is the response — the
 * vendor holds a token whose hash was never stored, which exchanges as
 * `not_found`; nothing usable survives.
 */
async function mintAndDeliverInvite(args: {
  req: Request;
  organizationId: string;
  engagementId: string;
  addressee: InviteAddressee;
  composition: { message: string | null; dueDate: string | null; sendEmail: boolean };
}): Promise<{
  inviteId: string;
  token: string;
  expiresAt: Date;
  message: string;
  emailDelivery: string;
  emailDetail: string | null;
}> {
  const { organizationId, engagementId, addressee, composition } = args;
  const names = await pg.query<{ org_name: string; vendor_name: string }>(
    `SELECT o.name AS org_name, v.name AS vendor_name
       FROM vendor_engagements e
       JOIN organizations o ON o.id = e.organization_id
       JOIN vendors v ON v.id = e.vendor_id
      WHERE e.id = $1 AND e.organization_id = $2 LIMIT 1`,
    [engagementId, organizationId]
  );
  const organizationName = names.rows[0]?.org_name ?? "Your customer";
  const vendorName = names.rows[0]?.vendor_name ?? "your organisation";
  const message =
    composition.message ??
    defaultInviteMessage({
      contactName: addressee.name,
      organizationName,
      vendorName,
      dueDate: composition.dueDate,
    });

  const invite = mintInviteToken();
  const inserted = await pg.query<{ id: string }>(
    `INSERT INTO vendor_engagement_invites
       (organization_id, engagement_id, invite_token_hash, contact_email, contact_name,
        expires_at, created_by_user_id, contact_id, message, due_date, email_delivery_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'not_attempted')
     RETURNING id`,
    [
      organizationId,
      engagementId,
      invite.tokenHash,
      addressee.email,
      addressee.name,
      invite.expiresAt,
      userOf(args.req),
      addressee.contactId,
      message,
      composition.dueDate,
    ]
  );
  const inviteId = inserted.rows[0]!.id;

  let emailDelivery = "not_attempted";
  let emailDetail: string | null = null;
  if (composition.sendEmail) {
    const delivery = await sendVendorInviteEmail({
      organizationId,
      inviteId,
      contactEmail: addressee.email,
      organizationName,
      vendorName,
      message,
      rawToken: invite.token,
      expiresAt: invite.expiresAt,
      dueDate: composition.dueDate,
    });
    emailDelivery = delivery.state;
    emailDetail = delivery.detail;
    await pg.query(
      `UPDATE vendor_engagement_invites
          SET email_delivery_state = $3, email_delivery_at = NOW(),
              email_provider_message_id = $4, email_delivery_detail = $5
        WHERE id = $1 AND organization_id = $2`,
      [inviteId, organizationId, delivery.state, delivery.providerMessageId, delivery.detail]
    );
  }

  return { inviteId, token: invite.token, expiresAt: invite.expiresAt, message, emailDelivery, emailDetail };
}

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
    //
    // Resolved BEFORE the #946 lock is taken: it only reads, and holding the
    // engagement row locked across a contact lookup would widen the lock for
    // no benefit. The lock's scope and the transition assertion below are
    // unchanged by this package.
    const addressee = await resolveInviteAddressee(organizationId, id, body);
    if (!addressee.ok) {
      res.status(addressee.status).json(
        addressee.message
          ? { error: addressee.error, message: addressee.message }
          : { error: addressee.error }
      );
      return;
    }
    const { email, contactId } = addressee.addressee;
    const composition = parseInviteComposition(body);
    if (!composition.ok) {
      res.status(400).json({ error: composition.error, message: composition.message });
      return;
    }

    // #946. LOCK the row for the rest of the transaction. This — not the
    // rowCount assertion further down — is the primary serialization
    // mechanism: a second concurrent issue blocks here until the first commits,
    // then re-reads `issued` and fails its own transition check. Without it,
    // check-then-act leaves a window in which two callers both pass
    // canTransition against the same `scoped` state.
    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements
        WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
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

    // VA-Q1 P2: the content-addressed identity of what is being sent, stamped
    // at the one moment scope freezes and never rewritten (ADR-0013 R3).
    // `GET /vendor-engagements/:id/integrity` recomputes and compares.
    //
    // #946: loaded UNDER THE LOCK, so the hash is computed from the exact
    // question set this transition is freezing. Loading it before the lock
    // would let the set move between hashing and freezing.
    const set = await loadQuestionSetItems(pg, organizationId, id);
    const setHash = set.unversioned === 0 ? questionSetHash(set.items) : null;

    // #946: THE TRANSITION HAPPENS FIRST, AND IS VERIFIED. The old order wrote
    // the credential first and never checked whether this UPDATE matched
    // anything, so a zero-row transition still returned 200 with a usable
    // invite. Nothing below runs unless exactly one row moved.
    const moved = await pg.query(
      `UPDATE vendor_engagements
          SET status = 'issued', issued_at = NOW(), updated_at = NOW(),
              question_set_hash = COALESCE($4, question_set_hash),
              question_set_hash_at = CASE WHEN $4 IS NOT NULL THEN NOW() ELSE question_set_hash_at END
        WHERE id = $1 AND organization_id = $2 AND status = $3`,
      [id, organizationId, from, setHash]
    );
    if (moved.rowCount !== 1) {
      // Unreachable while the FOR UPDATE lock holds — kept as an assertion, not
      // as the mechanism. If it ever fires, the state moved under a lock we
      // believed we held, and issuing anyway would mint a credential for an
      // engagement that was never issued.
      logger.error(
        {
          event: "vendor_engagement_issue_transition_lost",
          organizationId,
          engagementId: id,
          from,
          rowCount: moved.rowCount,
        },
        "Issue transition matched no row while holding FOR UPDATE"
      );
      res.status(409).json({
        error: "issue_conflict",
        message:
          "This engagement changed while it was being issued. Nothing was sent — re-read it and try again.",
      });
      return;
    }

    // Only now does a credential come into existence. Written on the TENANT
    // channel so it shares this transaction: if anything after this point
    // fails, the ROLLBACK takes the invite with it and no usable token
    // survives. RLS-safe — vendor_engagement_invites carries
    // `WITH CHECK (organization_id = current_setting('app.current_org_id'))`
    // and GRANTs INSERT to app_request (20260923_vendor_portal_access.sql).
    // The ELEVATED channel is still required for the pre-auth READ at exchange
    // time (vendorPortal.ts), a different operation, and is unchanged.
    // Goal §B: SecureLogic composes and sends the invitation itself. The
    // credential is minted, stored with the customer's message and due date,
    // and mailed through the shared transport — all inside this transaction.
    const invite = await mintAndDeliverInvite({
      req,
      organizationId,
      engagementId: id,
      addressee: addressee.addressee,
      composition,
    });

    // #946: deferred to AFTER COMMIT. writeAuditEvent goes to the elevated
    // pool, so calling it inline would record an issuance that a later
    // rollback erased. registerAfterCommit runs only on a durable commit and
    // is discarded on rollback.
    registerAfterCommit(() =>
      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_engagement.issued",
        resourceType: "vendor_engagement",
        resourceId: id,
        // The token is NEVER in the audit payload. An audit log readable by more
        // people than the vendor's mailbox must not contain a working credential.
        payload: {
          invite_id: invite.inviteId,
          contact_email: email,
          contact_id: contactId,
          expires_at: invite.expiresAt.toISOString(),
          due_date: composition.dueDate,
          email_delivery: invite.emailDelivery,
        },
        ipAddress: req.ip ?? null,
      })
    );

    // Buffered by the asTenant wrap and replayed only after COMMIT, so the raw
    // credential never reaches the caller ahead of the durable write it names.
    res.status(200).json({
      ok: true,
      status: "issued",
      invite_id: invite.inviteId,
      // Returned ONCE. Only the hash is stored. The app keeps it as the
      // SECONDARY recovery path ("copy secure link"); the email is the
      // primary delivery.
      invite_token: invite.token,
      expires_at: invite.expiresAt,
      contact_id: contactId,
      contact_email: email,
      due_date: composition.dueDate,
      // "sent" | "failed" | "suppressed" | "disabled" | "not_attempted" — the
      // customer is told the truth about whether anything left the building.
      email_delivery: invite.emailDelivery,
      email_delivery_detail: invite.emailDetail,
    });
  } catch (err) {
    logger.error({ event: "vendor_engagement_issue_failed", organizationId, err }, "Engagement issue failed");
    res.status(500).json({ error: "issue_failed" });
  }
}

/* =========================================================
   Invite lifecycle (goal §A/§B; lineage VA-L1, owner ruling 2026-08-23):
   ACCESS IS REVOKED, HISTORY IS PRESERVED.

   Revoking kills the invite AND its live sessions (the portal middleware
   treats invite revocation as authoritative on every request) and touches
   nothing else: responses, revisions, evidence, comments and audit rows stay
   exactly as they were, attributed to the invite they were made under.

   Re-issue is the RESEND and the RECOVERY path. Only a hash survives
   issuance, so "send it again" means minting a replacement; the prior
   credential and its sessions die when the replacement is born (single
   active invite per engagement — the duplicate-invitation rule), and the
   new one is addressed to a directory contact (or a raw address) and sent
   exactly like the first.
   ========================================================= */

export async function revokeEngagementInvite(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  // The schema's CHECK requires a non-empty reason whenever revoked_at is set
  // (20260923); the UI marks the reason optional, so an omitted reason gets
  // the honest default rather than a 23514 the customer cannot act on.
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

    const sessions = await pg.query<{ id: string }>(
      `UPDATE vendor_portal_sessions
          SET revoked_at = NOW()
        WHERE invite_id = ANY($1::uuid[]) AND organization_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [revoked.rows.map((r) => r.id), organizationId]
    );

    registerAfterCommit(() =>
      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_engagement.invite_revoked",
        resourceType: "vendor_engagement",
        resourceId: id,
        payload: {
          invite_ids: revoked.rows.map((r) => r.id),
          invites_revoked: revoked.rowCount,
          sessions_revoked: sessions.rowCount,
          reason,
        },
        ipAddress: req.ip ?? null,
      })
    );

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
    const addressee = await resolveInviteAddressee(organizationId, id, body);
    if (!addressee.ok) {
      res.status(addressee.status).json(
        addressee.message ? { error: addressee.error, message: addressee.message } : { error: addressee.error }
      );
      return;
    }
    const composition = parseInviteComposition(body);
    if (!composition.ok) {
      res.status(400).json({ error: composition.error, message: composition.message });
      return;
    }

    const eng = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagements
        WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const from = eng.rows[0]!.status as EngagementState;
    // Re-issue replaces the credential for an ALREADY-ISSUED engagement. A
    // never-issued engagement uses /issue; a submitted one has nothing for a
    // vendor to do with a link.
    if (!["issued", "in_progress", "clarification_requested"].includes(from)) {
      res.status(409).json({
        error: "cannot_reissue",
        from,
        message:
          from === "draft" || from === "scoping" || from === "scoped"
            ? "This engagement has not been issued yet — issue it first."
            : "The questionnaire is no longer open for vendor work — a new link would have nothing to do.",
      });
      return;
    }

    // Single-active-invite rule: the prior credential (and its live sessions)
    // die when the replacement is born. History stays.
    const prior = await pg.query<{ id: string }>(
      `UPDATE vendor_engagement_invites
          SET revoked_at = NOW(), revoked_by_user_id = $3,
              revocation_reason = 'superseded by re-issue'
        WHERE engagement_id = $1 AND organization_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [id, organizationId, userOf(req)]
    );
    if ((prior.rowCount ?? 0) > 0) {
      await pg.query(
        `UPDATE vendor_portal_sessions
            SET revoked_at = NOW()
          WHERE invite_id = ANY($1::uuid[]) AND organization_id = $2 AND revoked_at IS NULL`,
        [prior.rows.map((r) => r.id), organizationId]
      );
    }

    const invite = await mintAndDeliverInvite({
      req,
      organizationId,
      engagementId: id,
      addressee: addressee.addressee,
      composition,
    });

    registerAfterCommit(() =>
      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_engagement.invite_reissued",
        resourceType: "vendor_engagement",
        resourceId: id,
        // Token NEVER in the payload — same rule as issue.
        payload: {
          invite_id: invite.inviteId,
          contact_email: addressee.addressee.email,
          contact_id: addressee.addressee.contactId,
          expires_at: invite.expiresAt.toISOString(),
          due_date: composition.dueDate,
          email_delivery: invite.emailDelivery,
          prior_invites_revoked: prior.rowCount,
        },
        ipAddress: req.ip ?? null,
      })
    );

    res.status(200).json({
      ok: true,
      invite_id: invite.inviteId,
      // Returned ONCE, same contract as issue.
      invite_token: invite.token,
      expires_at: invite.expiresAt,
      contact_id: addressee.addressee.contactId,
      contact_email: addressee.addressee.email,
      due_date: composition.dueDate,
      prior_invites_revoked: prior.rowCount,
      email_delivery: invite.emailDelivery,
      email_delivery_detail: invite.emailDetail,
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
        methodology_version: await storedMethodologyVersion(organizationId, id),
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
        methodology_version: await storedMethodologyVersion(organizationId, id),
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
      question_version_id: string | null;
      domain: string | null;
    }>(
      `SELECT si.requirement_id, r.reference_id,
              COALESCE(qv.prompt, r.title) AS title,
              COALESCE(qv.guidance, r.description) AS description,
              si.question_version_id,
              si.depth, si.mandatory, si.domain,
              rr.id AS response_id, rr.status, rr.notes, rr.responder_type,
              rr.answered_via_invite_id, rr.assessed_by, rr.assessed_at, rr.updated_at,
              COUNT(ev.id)::text AS evidence_count,
              COALESCE(bool_or(ev.reviewed_at IS NOT NULL), FALSE) AS evidence_confirmed
         FROM vendor_engagement_scope_items si
         JOIN requirements r ON r.id = si.requirement_id
         -- VA-Q1 P2: the reviewer reads the SAME immutable text the vendor was
         -- asked. Pre-P2 rows have no version and fall back to the requirement.
         LEFT JOIN question_versions qv
                ON qv.id = si.question_version_id
               AND qv.organization_id = si.organization_id
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
        GROUP BY si.requirement_id, r.reference_id, qv.prompt, r.title, qv.guidance, r.description,
                 si.question_version_id,
                 si.depth, si.mandatory, si.domain,
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
        question_version_id: row.question_version_id,
        // VA-Q2 P2: null on items resolved under scope-rule 1.0.0.
        scope: { depth: row.depth, mandatory: row.mandatory, domain: row.domain },
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
        domains: summarizeDomains(items.map((i) => i.scope.domain)),
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

    const moved = await pg.query(
      `UPDATE vendor_engagements
          SET status = 'analysis_complete',
              analysis_coverage = $3, analysis_coverage_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = $4`,
      [id, organizationId, coverage, from]
    );

    // ── WA-1 / owner ruling 6: the portal's participation window ends HERE ──
    //
    // `analysis_complete` is the exact state at which this engagement leaves
    // the vendor's reach: `isPortalRespondable` already refused writes from
    // `submitted` onward, `isPortalCommentable` stops at this state, and no
    // transition returns from here to any portal-reachable state. The only
    // route back to a vendor is `in_review -> clarification_requested`, which
    // is unreachable once we are past `in_review`.
    //
    // Terminating at `submitted` instead would have been wrong: that state is
    // deliberately reopenable via clarification, and revoking there would break
    // the one workflow the state exists for.
    //
    // ENGAGEMENT-SCOPED BY CONSTRUCTION, which is the ruling's other half. A
    // portal session belongs to exactly one invite and one engagement
    // (vendor_portal_sessions.engagement_id), so this cannot touch a contact's
    // access to a DIFFERENT active engagement — there is no shared credential
    // to damage. Revoking the invite is what makes it stick: requirePortalSession
    // re-reads the invite on every request and treats a revoked one as killing
    // every session minted from it, so a stale emailed link cannot mint a fresh
    // session for a concluded assessment.
    //
    // Guarded on `moved.rowCount`: a conditional side effect must not run when
    // the transition it belongs to did not happen.
    let accessRevoked: { invites: number; sessions: number } | null = null;
    if (moved.rowCount === 1) {
      const invites = await pg.query<{ id: string }>(
        `UPDATE vendor_engagement_invites
            SET revoked_at = NOW(), revoked_by_user_id = $3,
                revocation_reason = 'engagement concluded — analysis complete'
          WHERE engagement_id = $1 AND organization_id = $2 AND revoked_at IS NULL
          RETURNING id`,
        [id, organizationId, userOf(req)]
      );
      const sessions = await pg.query(
        `UPDATE vendor_portal_sessions
            SET revoked_at = NOW()
          WHERE engagement_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
        [id, organizationId]
      );
      accessRevoked = { invites: invites.rowCount ?? 0, sessions: sessions.rowCount ?? 0 };
    }

    writeAuditEvent({
      organizationId,
      actorUserId: userOf(req),
      eventType: "vendor_engagement.analysis_completed",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        analysis_coverage: coverage,
        // Recorded on the same event rather than a separate one: the revocation
        // is not an independent decision, it is what completing the analysis
        // MEANS for the vendor's access, and splitting them would let a reader
        // find one without the other.
        portal_invites_revoked: accessRevoked?.invites ?? 0,
        portal_sessions_revoked: accessRevoked?.sessions ?? 0,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      ok: true,
      status: "analysis_complete",
      analysis_coverage: coverage,
      portal_access_revoked: accessRevoked,
    });
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

/* =========================================================
   VA-Q2 P3 — the canonical fact store, internal intake surface
   (assessment_facts; D1 Option B).

   GET  /vendor-engagements/:id/facts   every row of THIS subject (history
        included, with source / origin / status / provenance / timing) plus
        the resolved set the scope resolver would read — never cross-subject.
   PUT  /vendor-engagements/:id/facts   batch declaration. Body:
        { facts: [{ fact_key, value, source?, origin?, observed_at? }] }
        - subject_type / subject_id / status / verified_at / provenance in the
          body are IGNORED (forced server-side; the subject is the path id,
          resolved inside the tenant scope);
        - source defaults to `intake`; only `intake` | `internal_user` may be
          declared here (a human cannot assert a `system_derived` mirror, a
          vendor answer or a model extraction — those have their own writers,
          none in Q2) → 400 `source` otherwise;
        - origin defaults to `intake` and must be `intake` → 400 otherwise;
        - unknown key / malformed value → 400 with field names;
        - engagement issued → 409 scope_frozen (the widen-only path for an
          issued subject is Q3's vendor_response writer, not this route);
        - subject missing or another org's → 404 (never 403: no oracle).
        Audit carries KEYS only — never values (T-13).
   ========================================================= */

const FACT_ROUTE_SOURCES: readonly FactSource[] = ["intake", "internal_user"];
const FACT_ROUTE_ORIGIN: FactOrigin = "intake";
const MAX_FACTS_PER_PUT = 200;

function publicFactRow(r: StoredFactRow): Record<string, unknown> {
  return {
    id: r.id,
    fact_key: r.fact_key,
    value: r.value,
    source: r.source,
    origin: r.origin,
    status: r.status,
    provenance: r.provenance,
    observed_at: r.observed_at,
    verified_at: r.verified_at,
    confidence: r.confidence,
    supersedes_id: r.supersedes_id,
    accepted_at: r.accepted_at,
    created_at: r.created_at,
  };
}

async function loadFactsPayload(organizationId: string, subject: NonNullable<Awaited<ReturnType<typeof resolveFactSubject>>>) {
  const rows = await loadFactRows(pg, organizationId, subject);
  const resolved = resolveFacts(rows.filter((r) => r.status === "accepted"));
  return {
    subject: { subject_type: subject.kind, subject_id: subject.id },
    status: subject.state,
    scope_rule_version: subject.scope_rule_version,
    resolved,
    facts: rows.map(publicFactRow),
  };
}

export async function getEngagementFacts(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  try {
    const subject = await resolveFactSubject(pg, organizationId, "vendor_engagement", id);
    if (!subject) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    res.status(200).json(await loadFactsPayload(organizationId, subject));
  } catch (err) {
    logger.error({ event: "vendor_engagement_facts_read_failed", organizationId, err }, "Facts read failed");
    res.status(500).json({ error: "facts_read_failed" });
  }
}

type FactInputError = { index: number; errors: FactValidationError[] };

/** Parse + validate the PUT body. Values never leave this function except inside the writes. */
function parseFactWrites(
  body: unknown,
  actorUserId: string | null,
  now: Date
): { ok: true; writes: FactWrite[] } | { ok: false; error: string; details?: FactInputError[] } {
  if (!body || typeof body !== "object" || !Array.isArray((body as { facts?: unknown }).facts)) {
    return { ok: false, error: "facts_required" };
  }
  const items = (body as { facts: unknown[] }).facts;
  if (items.length === 0) return { ok: false, error: "facts_required" };
  if (items.length > MAX_FACTS_PER_PUT) return { ok: false, error: "too_many_facts" };

  const writes: FactWrite[] = [];
  const details: FactInputError[] = [];
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      details.push({ index, errors: [{ field: "fact_key", reason: "each fact must be an object" }] });
      return;
    }
    const f = item as Record<string, unknown>;
    const errors: FactValidationError[] = [];

    const source: unknown = f["source"] === undefined ? "intake" : f["source"];
    if (!isFactSource(source) || !FACT_ROUTE_SOURCES.includes(source)) {
      errors.push({ field: "source", reason: `must be one of: ${FACT_ROUTE_SOURCES.join(", ")} (of ${FACT_SOURCES.join(", ")})` });
    }
    const origin: unknown = f["origin"] === undefined ? FACT_ROUTE_ORIGIN : f["origin"];
    if (!isFactOrigin(origin) || origin !== FACT_ROUTE_ORIGIN) {
      errors.push({ field: "origin", reason: `must be ${FACT_ROUTE_ORIGIN} on this route (of ${FACT_ORIGINS.join(", ")})` });
    }
    let observedAt = now;
    if (f["observed_at"] !== undefined) {
      const t = typeof f["observed_at"] === "string" ? new Date(f["observed_at"]) : new Date(NaN);
      if (Number.isNaN(t.getTime()) || t.getTime() > now.getTime() + 5_000) {
        errors.push({ field: "value", reason: "observed_at must be an ISO-8601 timestamp not in the future" });
      } else {
        observedAt = t;
      }
    }
    // `core.*` is mirrored from the 13 inherent-risk columns on every scope
    // resolve (mirrorInherentFacts) — the columns are the store of record, so a
    // declared core.* row would be silently superseded before it could ever
    // influence scope. Refuse it and point the caller at the real writer.
    if (typeof f["fact_key"] === "string" && f["fact_key"].startsWith("core.")) {
      errors.push({ field: "fact_key", reason: "core.* facts are derived from the inherent-risk intake; use PATCH /inherent" });
    }
    // Registry validation runs even when source/origin failed, so the caller
    // sees every defect at once; subject_type is forced, not read from the body.
    const v = validateFact(f["fact_key"], f["value"], isFactSource(source) ? source : "intake", isFactOrigin(origin) ? origin : "intake", "vendor_engagement");
    if (!v.ok) errors.push(...v.errors.filter((e) => !errors.some((x) => x.field === e.field)));
    if (errors.length > 0) {
      details.push({ index, errors });
      return;
    }
    if (!v.ok) return; // unreachable: errors would be non-empty
    writes.push({
      fact_key: v.key,
      value: v.value,
      source: v.source,
      origin: v.origin,
      observed_at: observedAt,
      provenance: {
        actor: { kind: actorUserId ? "user" : "system", id: actorUserId },
        via: "PUT /vendor-engagements/:id/facts",
        at: now.toISOString(),
        evidence: null,
        model: null,
      },
      created_by: actorUserId,
    });
  });
  if (details.length > 0) return { ok: false, error: "invalid_facts", details };
  return { ok: true, writes };
}

export async function putEngagementFacts(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const actorUserId = userOf(req);

  try {
    // Subject FIRST (404 before any body detail leaks a validation shape to a
    // caller who does not own the engagement).
    const subject = await resolveFactSubject(pg, organizationId, "vendor_engagement", id);
    if (!subject) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    if (!isScopeMutable(subject.state)) {
      res.status(409).json({
        error: "scope_frozen",
        message: "The questionnaire has been issued. Its facts are frozen from this surface — a vendor's answers are only meaningful against the questions they were asked.",
        status: subject.state,
      });
      return;
    }

    const parsed = parseFactWrites(req.body, actorUserId, new Date());
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error, details: parsed.details ?? [] });
      return;
    }

    let outcome;
    try {
      outcome = await writeFacts(pg, organizationId, subject, parsed.writes);
    } catch (err) {
      if (err instanceof FactStoreValidationError) {
        res.status(400).json({ error: "invalid_facts", details: [{ index: err.index, errors: err.errors }] });
        return;
      }
      throw err;
    }

    writeAuditEvent({
      organizationId,
      actorUserId,
      eventType: "vendor_engagement.facts_declared",
      resourceType: "vendor_engagement",
      resourceId: id,
      // Keys and counts only — never a value (T-13).
      payload: {
        keys: outcome.keys,
        inserted: outcome.inserted,
        unchanged: outcome.unchanged,
        superseded: outcome.superseded,
        source: [...new Set(parsed.writes.map((w) => w.source))],
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      inserted: outcome.inserted,
      unchanged: outcome.unchanged,
      superseded: outcome.superseded,
      ...(await loadFactsPayload(organizationId, subject)),
    });
  } catch (err) {
    logger.error({ event: "vendor_engagement_facts_write_failed", organizationId, err }, "Facts write failed");
    res.status(500).json({ error: "facts_write_failed" });
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

/* =========================================================
   GET /api/vendor-engagements/:id/assurance-coverage

   The assurance-gap view: which of this engagement's requirements already
   carry sufficient, current, governed assurance — and, just as importantly,
   which SUFFICIENT determinations do NOT count right now and exactly why
   (identity unresolved, class unclassifiable, no ratified policy, window
   expired). Read-only, computed by the same counting predicate the scope
   resolver applies, so what the reviewer sees is what the composition will do.
   ========================================================= */
export async function getAssuranceCoverage(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query(
      `SELECT 1 FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) { res.status(404).json({ error: "engagement_not_found" }); return; }

    const coverage = await resolveAssuranceCoverage({ organizationId, engagementId: id });
    res.status(200).json({
      engagement_id: id,
      coverage_version: coverage.version,
      as_of: coverage.asOf,
      applied_at_composition: evidenceLifecycleV2Enabled(process.env),
      covered: coverage.covered.map((c) => ({
        requirement_id: c.requirementId,
        requirement_reference: c.requirementReference,
        determination_id: c.determinationId,
        document_id: c.documentId,
        valid_until: c.validUntil,
        validity_source: c.validitySource,
        assurance_class: c.assuranceClass,
      })),
      gaps: coverage.gaps.map((g) => ({
        determination_id: g.determinationId,
        requirement_reference: g.requirementReference,
        requirement_id: g.requirementId,
        reason: g.reason,
        detail: g.detail,
      })),
      // Confirmed, current, requirement-grain governed evidence. VISIBLE and
      // explicitly NON-COUNTING: `counts` is always false and none of these
      // rows is in `covered`, so questionnaire depth is unaffected by every one
      // of them. Before this, curating a pen test or an ISO certificate showed
      // a reviewer nothing at all, which reads as "no evidence exists".
      governed_evidence_version: coverage.governedEvidenceVersion,
      governed_evidence: coverage.governedEvidence.map((g) => ({
        link_id: g.linkId,
        evidence_id: g.evidenceId,
        requirement_id: g.requirementId,
        requirement_reference: g.requirementReference,
        assurance_class: g.assuranceClass,
        validity_basis: g.validityBasis,
        valid_until: g.validUntil,
        confirmed_at: g.confirmedAt,
        superseded_by_newer_version: g.supersededByNewerVersion,
        counts: g.counts,
        reason: g.reason,
      })),
    });
  } catch (err) {
    logger.error({ event: "assurance_coverage_read_failed", engagementId: id, err },
      "Assurance coverage read failed");
    res.status(500).json({ error: "assurance_coverage_unavailable" });
  }
}

router.get("/vendor-engagements/:id", ...chain, asTenant(getEngagement));
router.patch("/vendor-engagements/:id/inherent", ...chain, asTenant(overrideInherent));
router.post("/vendor-engagements/:id/scope", ...chain, asTenant(resolveScope));
router.get("/vendor-engagements/:id/assurance-coverage", ...chain, asTenant(getAssuranceCoverage));
router.get("/vendor-engagements/:id/composition", ...chain, asTenant(getComposition));
router.get("/vendor-engagements/:id/facts", ...chain, asTenant(getEngagementFacts));
router.put("/vendor-engagements/:id/facts", ...chain, asTenant(putEngagementFacts));
router.post("/vendor-engagements/:id/recompute", ...chain, asTenant(recomputeRisk));
router.post("/vendor-engagements/:id/decision", ...chain, asTenant(recordDecision));
router.get("/vendor-engagements/:id/evidence", ...chain, asTenant(listEngagementEvidence));
router.get("/vendor-engagements/:id/responses", ...chain, asTenant(listEngagementResponses));
router.get("/vendor-engagements/:id/integrity", ...chain, asTenant(checkQuestionnaireIntegrity));
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

// #946: takes the asTenant wrap like every sibling. It previously managed its
// own withTenant scope because the invite was written on the ELEVATED channel;
// the invite now rides the tenant transaction, so there is nothing left to
// manage. The wrap matters for more than tidiness — it BUFFERS the response and
// replays it only after COMMIT, which is what stops a raw invite token (and a
// 200 claiming `status: "issued"`) from reaching the caller before the
// transition is durable. The pre-auth READ of the invite at exchange time is
// still elevated; that lives in vendorPortal.ts and is unchanged.
router.post("/vendor-engagements/:id/issue", ...chain, asTenant(issueEngagement));
router.post("/vendor-engagements/:id/invite/revoke", ...chain, asTenant(revokeEngagementInvite));
router.post("/vendor-engagements/:id/invite/reissue", ...chain, asTenant(reissueEngagementInvite));

// WA-2: a recorded disagreement with a composition decision. Never a removal
// path — see the handler header and owner ruling 2.
router.post("/vendor-engagements/:id/applicability-challenges", ...chain, asTenant(raiseApplicabilityChallenge));
router.get("/vendor-engagements/:id/applicability-challenges", ...chain, asTenant(listApplicabilityChallenges));


/* =========================================================
   GET /api/vendor-engagements/:id/integrity — VA-Q1 P2.

   Recomputes the content-addressed identity of the questionnaire from the
   stored scope items and compares it with the hash stamped at issue.

     match      what the vendor was asked is exactly what was issued
     drift      the stored items no longer hash to the stamp — an incident,
                not a warning: something mutated an issued questionnaire
     unstamped  issued before P2, or has items without a version (pre-P2
                rows); nothing to compare against
     unissued   scope not frozen yet; the hash is not defined
   ========================================================= */
export async function checkQuestionnaireIntegrity(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  try {
    const eng = await pg.query<{ status: string; issued_at: string | null; question_set_hash: string | null; question_set_hash_at: string | null }>(
      `SELECT status, issued_at, question_set_hash, question_set_hash_at
         FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    const row = eng.rows[0]!;
    const set = await loadQuestionSetItems(pg, organizationId, id);
    const computed = set.unversioned === 0 && set.items.length > 0 ? questionSetHash(set.items) : null;

    let verdict: "match" | "drift" | "unstamped" | "unissued";
    if (!row.issued_at) verdict = "unissued";
    else if (!row.question_set_hash || computed === null) verdict = "unstamped";
    else verdict = computed === row.question_set_hash ? "match" : "drift";

    if (verdict === "drift") {
      logger.error(
        { event: "questionnaire_integrity_drift", organizationId, engagementId: id, stamped: row.question_set_hash, computed },
        "Issued questionnaire no longer hashes to its stamp"
      );
    }
    res.status(200).json({
      engagement_id: id,
      verdict,
      stamped_hash: row.question_set_hash,
      stamped_at: row.question_set_hash_at,
      computed_hash: computed,
      items: set.items.length,
      unversioned_items: set.unversioned,
    });
  } catch (err) {
    logger.error({ err, organizationId, engagementId: id }, "GET /vendor-engagements/:id/integrity failed");
    res.status(500).json({ error: "internal_error" });
  }
}

/* =========================================================
   GET /api/vendor-engagements/:id/composition — what SecureLogic composed
   for this engagement and why (Assessment Composition v1).

   The LATEST immutable snapshot, plus how many resolves preceded it. Null
   when the scope has never been resolved. Cross-tenant answers 404, never an
   empty body — same rule as the coverage surface.
   ========================================================= */
export async function getComposition(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const id = String(req.params["id"] ?? "");

  try {
    const eng = await pg.query<{ status: string; scope_rule_version: string | null }>(
      `SELECT status, scope_rule_version FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) { res.status(404).json({ error: "engagement_not_found" }); return; }

    const { latest, history_count } = await loadLatestCompositionSnapshot(pg, organizationId, id);
    res.status(200).json({
      engagement_id: id,
      status: eng.rows[0]!.status,
      scope_rule_version: eng.rows[0]!.scope_rule_version,
      composition: latest
        ? {
            ...latest.snapshot,
            id: latest.id,
            hash: latest.snapshot_hash,
          }
        : null,
      history_count,
    });
  } catch (err) {
    logger.error({ err, organizationId, engagementId: id }, "GET /vendor-engagements/:id/composition failed");
    res.status(500).json({ error: "composition_unavailable" });
  }
}

/* =========================================================
   Applicability CHALLENGES — WA-2, owner ruling 2 (2026-09-04).

   A recorded disagreement with one composition decision. It is a RECORD, never
   a mechanism: nothing here removes a requirement, lowers a tier, edits a
   scope item or touches the SecureLogic Core Assurance floor. The ruling is
   explicit that an applicable Core objective may not be suppressed — not with
   a reason, not with a second approver — so no route offers to.

   The resolution path is the ordinary product path, and the response says so:
   correct the relationship's facts, re-record the intake (which now carries its
   own reason), and compose again. That produces a NEW immutable snapshot
   recording the objective as not applicable, with the facts it read — an
   applicability determination with provenance, which is what the ruling asks
   for, rather than an override that removed something applicable.
   ========================================================= */

/** Outcomes a composition can record for an item. Mirrors the snapshot contract. */
const CHALLENGEABLE_OUTCOMES = new Set([
  "asked",
  "evidence_satisfied",
  "not_applicable",
  "not_provisioned",
]);

export async function raiseApplicabilityChallenge(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const reference = typeof body.requirement_reference === "string" ? body.requirement_reference.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!reference) {
    res.status(400).json({ error: "requirement_reference_required" });
    return;
  }
  // Same bar as the inherent-risk override: a governance act carries its reason
  // or it does not happen.
  if (reason.length < 10) {
    res.status(400).json({
      error: "reason_required",
      message: "Explain why you disagree with this determination. It is recorded against the engagement with your name.",
    });
    return;
  }
  // A challenge names a HUMAN. An API-key integration raising an anonymous
  // objection into an audit trail is worse than no record — the 20261071
  // posture, applied at birth rather than retrofitted.
  const actor = userOf(req);
  if (!actor) {
    res.status(403).json({
      error: "human_actor_required",
      message: "A challenge is recorded against the person raising it, so it cannot be raised with an API key alone.",
    });
    return;
  }

  try {
    const eng = await pg.query(
      `SELECT 1 FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }

    // The determination being challenged is read from the LATEST snapshot, not
    // taken from the caller: the outcome and rationale must be SecureLogic's
    // own words, or the record would preserve the objector's account of what
    // the platform said rather than what it said.
    const { latest } = await loadLatestCompositionSnapshot(pg, organizationId, id);
    if (!latest) {
      res.status(409).json({
        error: "not_composed",
        message: "This engagement has no composition yet, so there is no determination to challenge.",
      });
      return;
    }
    const snapshot = latest.snapshot;
    // Read DEFENSIVELY. `snapshot` is stored JSONB written under a versioned
    // contract (`snapshot_version`), and this route may one day read a row a
    // newer or older writer produced. Assuming the shape would turn the first
    // such row into a 500 on a governance surface; treating a missing branch as
    // "no such determination" degrades to an honest 404 instead.
    const objectives = Array.isArray(snapshot.core_assurance?.objectives)
      ? snapshot.core_assurance.objectives
      : [];
    const additionals = Array.isArray(snapshot.additional) ? snapshot.additional : [];
    const objective = objectives.find((o) => o.reference === reference) ?? null;
    const additional = additionals.find((a) => a.reference === reference) ?? null;
    if (!objective && !additional) {
      res.status(404).json({
        error: "determination_not_found",
        message: "That reference is not part of this engagement's composition.",
      });
      return;
    }
    const outcome = objective ? objective.outcome : additional!.outcome;
    if (!CHALLENGEABLE_OUTCOMES.has(outcome)) {
      res.status(400).json({ error: "outcome_not_challengeable", outcome });
      return;
    }
    const requirementId = objective ? objective.requirement_id : additional!.requirement_id;
    const rationale = objective
      ? objective.rationale
      : additional!.reasons.map((r) => r.rationale).join(" ") || null;

    const inserted = await pg.query<{ id: string; created_at: string }>(
      `INSERT INTO vendor_engagement_applicability_challenges
         (organization_id, engagement_id, snapshot_id, snapshot_hash,
          requirement_id, requirement_reference, challenged_outcome,
          challenged_rationale, reason, raised_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, created_at`,
      [organizationId, id, latest.id, latest.snapshot_hash, requirementId, reference,
       outcome, rationale, reason.slice(0, 4000), actor]
    );

    writeAuditEvent({
      organizationId,
      actorUserId: actor,
      eventType: "vendor_engagement.applicability_challenged",
      resourceType: "vendor_engagement",
      resourceId: id,
      payload: {
        requirement_reference: reference,
        challenged_outcome: outcome,
        snapshot_hash: latest.snapshot_hash,
        reason,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({
      challenge: {
        id: inserted.rows[0]!.id,
        requirement_reference: reference,
        challenged_outcome: outcome,
        created_at: inserted.rows[0]!.created_at,
      },
      // Said explicitly, because the one thing a challenge must never imply is
      // that the questionnaire just changed.
      composition_unchanged: true,
      // CAREFULLY WORDED. The obvious sentence here — "correct the facts and
      // compose again" — is the ruling's resolution path and it does NOT work
      // on an engagement that already exists: createEngagement copies the
      // relationship's facts and tier onto the engagement row, resolveScope
      // composes from THOSE, and nothing updates them afterwards. Telling an
      // analyst otherwise would send them to re-record an intake, watch the
      // composition not move, and lose confidence in the record they just
      // made. Whether a not-yet-issued engagement should re-read current facts
      // is an owner decision (reported, not assumed); until it is taken, this
      // says what actually happens.
      resolution:
        "Recorded against this engagement's current determination. It does not change the assessment. " +
        "If the determination rests on a fact that is wrong, correct the relationship's intake: that re-derives " +
        "Criticality, Inherent risk and the tier on the relationship and applies to assessments opened afterwards. " +
        "This engagement composes on the facts it was opened with, so reassessing on the corrected facts means opening a new engagement from the relationship.",
    });
  } catch (err) {
    logger.error({ event: "applicability_challenge_failed", organizationId, engagementId: id, err }, "Applicability challenge failed");
    res.status(500).json({ error: "applicability_challenge_failed" });
  }
}

export async function listApplicabilityChallenges(req: Request, res: Response): Promise<void> {
  const organizationId = orgOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = String(req.params["id"] ?? "");
  try {
    const eng = await pg.query(
      `SELECT 1 FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (eng.rowCount === 0) {
      res.status(404).json({ error: "engagement_not_found" });
      return;
    }
    // `superseded` is DERIVED, never stored: a challenge is superseded when the
    // snapshot it disputed is no longer the current one, which means the
    // composition has been re-run since. An append-only record with a mutable
    // status column would be an append-only record with a lie in it.
    const { latest } = await loadLatestCompositionSnapshot(pg, organizationId, id);
    const rows = await pg.query(
      `SELECT c.id, c.requirement_reference, c.requirement_id, c.challenged_outcome,
              c.challenged_rationale, c.reason, c.snapshot_hash, c.created_at,
              c.raised_by_user_id, u.email AS raised_by_email, u.name AS raised_by_name
         FROM vendor_engagement_applicability_challenges c
         LEFT JOIN users u ON u.id = c.raised_by_user_id AND u.organization_id = c.organization_id
        WHERE c.organization_id = $1 AND c.engagement_id = $2
        ORDER BY c.created_at DESC`,
      [organizationId, id]
    );
    res.status(200).json({
      challenges: rows.rows.map((r) => ({
        ...r,
        superseded: latest ? r.snapshot_hash !== latest.snapshot_hash : false,
      })),
      count: rows.rowCount,
      current_snapshot_hash: latest?.snapshot_hash ?? null,
    });
  } catch (err) {
    logger.error({ event: "applicability_challenge_list_failed", organizationId, engagementId: id, err }, "Applicability challenge list failed");
    res.status(500).json({ error: "applicability_challenge_list_failed" });
  }
}

export default router;
