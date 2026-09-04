/**
 * vendorRelationships.ts — Vendor Onboarding 2.0: the relationship/service
 * grain and the factual intake that classifies it.
 *
 *   organization -> vendor -> RELATIONSHIP -> engagement
 *
 * A relationship is what the customer actually buys from a vendor. It carries
 * the customer's factual intake (append-only, versioned) and the DERIVED
 * classification the three deterministic engines produce from it: criticality,
 * inherent risk v2, and the assessment tier as their joint function. Nothing
 * here asks the customer for a classification — that is the failure Onboarding
 * 2.0 exists to remove.
 *
 * Every write is a single transaction (asTenant): an intake version is never
 * committed without the classification it produced, and a classification never
 * points at an intake that did not commit.
 *
 * Reachable only through the Vendor Assurance gate: dark in production.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { vendorAssuranceFeatureFlag } from "../lib/vendorAssuranceFeatureFlag.js";
import { ASSESSMENT_TIERS, type AssessmentTier } from "../lib/vendorRisk/riskBands.js";
import {
  MTD_LEVELS,
  CRITICALITY_DEPENDENCY_LEVELS,
  BUSINESS_REACH_LEVELS,
  SUBSTITUTABILITY_LEVELS,
  PROCESS_COUPLING_LEVELS,
  CRITICALITY_CONCENTRATION_LEVELS,
} from "../lib/vendorRisk/criticality.js";
import {
  DATA_SENSITIVITY_LEVELS,
  DATA_VOLUME_BANDS,
  ACCESS_LEVELS,
  REGULATORY_EXPOSURE_LEVELS,
  AI_INVOLVEMENT_LEVELS,
  AI_AUTONOMY_LEVELS,
  HOSTING_MODELS,
  FOURTH_PARTY_LEVELS,
} from "../lib/vendorRisk/inherentRiskV2.js";
import { resolveAssessmentTier } from "../lib/vendorRisk/assessmentTier.js";
import {
  classifyRelationship,
  type RelationshipIntakeFacts,
} from "../lib/vendorRisk/relationshipClassification.js";

const router = Router();

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;

/* ── helpers (same shapes as vendorContacts.ts) ────────────────────────────── */

function orgOf(req: Request): string | null {
  return (req as Request & { organizationContext?: { organizationId?: string } })
    .organizationContext?.organizationId ?? null;
}
function userOf(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}
function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
async function ownVendor(organizationId: string, vendorId: string): Promise<boolean> {
  const res = await pg.query(`SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`, [vendorId, organizationId]);
  return (res.rowCount ?? 0) > 0;
}

export type VendorRelationshipRow = {
  id: string;
  vendor_id: string;
  name: string;
  service_description: string | null;
  status: string;
  is_primary: boolean;
  policy_minimum_tier: AssessmentTier | null;
  criticality_score: number | null;
  criticality_band: string | null;
  criticality_arithmetic_band: string | null;
  criticality_basis: unknown;
  criticality_methodology_version: string | null;
  inherent_score: number | null;
  inherent_band: string | null;
  inherent_arithmetic_band: string | null;
  inherent_basis: unknown;
  inherent_methodology_version: string | null;
  assessment_tier: AssessmentTier | null;
  tier_calculated_minimum: AssessmentTier | null;
  tier_basis: unknown;
  tier_methodology_version: string | null;
  classification_intake_id: string | null;
  classification_computed_at: string | null;
  created_at: string;
  updated_at: string;
};

const RELATIONSHIP_SELECT = `
  id, vendor_id, name, service_description, status, is_primary, policy_minimum_tier,
  criticality_score, criticality_band, criticality_arithmetic_band, criticality_basis, criticality_methodology_version,
  inherent_score, inherent_band, inherent_arithmetic_band, inherent_basis, inherent_methodology_version,
  assessment_tier, tier_calculated_minimum, tier_basis, tier_methodology_version,
  classification_intake_id, classification_computed_at, created_at, updated_at`;

/**
 * The transition state (owner ruling M5). A relationship with no classification
 * is `intake_required` — rendered as ignorance, never as a zero or a rating.
 */
function withState(row: VendorRelationshipRow): VendorRelationshipRow & { classification_state: "classified" | "intake_required" } {
  return { ...row, classification_state: row.assessment_tier ? "classified" : "intake_required" };
}

async function resolveRelationship(organizationId: string, vendorId: string, relationshipId: string): Promise<VendorRelationshipRow | null> {
  const res = await pg.query<VendorRelationshipRow>(
    `SELECT ${RELATIONSHIP_SELECT} FROM vendor_relationships
      WHERE id = $1 AND organization_id = $2 AND vendor_id = $3 LIMIT 1`,
    [relationshipId, organizationId, vendorId]
  );
  return res.rows[0] ?? null;
}

const GUARDS = [
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  // Declaring what the organisation depends on, and how much, is a governance
  // act — the same posture as the engagement and contact routes it feeds.
  denyContributor(),
] as const;

/* ── intake validation ─────────────────────────────────────────────────────
   Every field is REQUIRED. A defaulted input is the worst failure mode: it
   produces a confident classification from answers nobody gave. The allowed
   values are IMPORTED from the engines, never re-declared — the v1 route once
   listed ai_autonomy by hand and got it wrong.
   ────────────────────────────────────────────────────────────────────────── */

const INTAKE_FIELDS: Record<string, readonly string[]> = {
  max_tolerable_disruption: MTD_LEVELS,
  operational_dependency: CRITICALITY_DEPENDENCY_LEVELS,
  business_reach: BUSINESS_REACH_LEVELS,
  substitutability: SUBSTITUTABILITY_LEVELS,
  process_coupling: PROCESS_COUPLING_LEVELS,
  concentration: CRITICALITY_CONCENTRATION_LEVELS,
  data_sensitivity: DATA_SENSITIVITY_LEVELS,
  data_volume: DATA_VOLUME_BANDS,
  access_level: ACCESS_LEVELS,
  regulatory_exposure: REGULATORY_EXPOSURE_LEVELS,
  ai_involvement: AI_INVOLVEMENT_LEVELS,
  ai_autonomy: AI_AUTONOMY_LEVELS,
  hosting_model: HOSTING_MODELS,
  fourth_party_exposure: FOURTH_PARTY_LEVELS,
};

type IntakeValidation =
  | { ok: true; facts: RelationshipIntakeFacts }
  | { ok: false; error: "incomplete_intake"; missing: string[]; invalid: string[] };

export function validateRelationshipIntake(body: unknown): IntakeValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  const missing: string[] = [];
  const invalid: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [field, allowed] of Object.entries(INTAKE_FIELDS)) {
    const v = b[field];
    if (typeof v !== "string" || v.length === 0) missing.push(field);
    else if (!allowed.includes(v)) invalid.push(field);
    else out[field] = v;
  }
  if (typeof b.regulatory_breach_notification !== "boolean") missing.push("regulatory_breach_notification");
  else out.regulatory_breach_notification = b.regulatory_breach_notification;
  // Autonomy without involvement is a contradiction, not a fact (mirrors the CHECK).
  if (out.ai_involvement === "none" && out.ai_autonomy !== undefined && out.ai_autonomy !== "none") invalid.push("ai_autonomy");
  if (missing.length > 0 || invalid.length > 0) return { ok: false, error: "incomplete_intake", missing, invalid };
  return { ok: true, facts: out as unknown as RelationshipIntakeFacts };
}

/* =========================================================
   GET /api/vendors/:id/relationships
   ========================================================= */
router.get(
  "/vendors/:id/relationships",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const vendorId = String(req.params["id"] ?? "");
    try {
      if (!(await ownVendor(organizationId, vendorId))) { res.status(404).json({ error: "vendor_not_found" }); return; }
      const rows = await pg.query<VendorRelationshipRow>(
        `SELECT ${RELATIONSHIP_SELECT} FROM vendor_relationships
          WHERE organization_id = $1 AND vendor_id = $2
          ORDER BY is_primary DESC, status ASC, lower(name) ASC`,
        [organizationId, vendorId]
      );
      const relationships = rows.rows.map(withState);
      res.status(200).json({
        relationships,
        count: relationships.length,
        intake_required_count: relationships.filter((r) => r.classification_state === "intake_required").length,
      });
    } catch (err) {
      logger.error({ event: "vendor_relationships_list_failed", organizationId, err }, "Relationship list failed");
      res.status(500).json({ error: "vendor_relationships_list_failed" });
    }
  })
);

/* =========================================================
   POST /api/vendors/:id/relationships
   ========================================================= */
router.post(
  "/vendors/:id/relationships",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const vendorId = String(req.params["id"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = str(body.name, MAX_NAME);
    if (!name) { res.status(400).json({ error: "name_required" }); return; }
    if (body.policy_minimum_tier !== undefined && body.policy_minimum_tier !== null &&
        !ASSESSMENT_TIERS.includes(body.policy_minimum_tier as AssessmentTier)) {
      res.status(400).json({ error: "invalid_policy_minimum_tier", allowed: [...ASSESSMENT_TIERS] }); return;
    }
    try {
      if (!(await ownVendor(organizationId, vendorId))) { res.status(404).json({ error: "vendor_not_found" }); return; }

      // The first relationship a vendor gets is the primary — the common
      // one-vendor/one-service case needs no extra click. An explicit
      // is_primary demotes the current primary in the same transaction, so
      // there is never a window with two or none (same pattern as contacts).
      const existing = await pg.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM vendor_relationships WHERE organization_id = $1 AND vendor_id = $2`,
        [organizationId, vendorId]
      );
      const isFirst = existing.rows[0]!.n === "0";
      const wantsPrimary = isFirst || body.is_primary === true;
      if (wantsPrimary && !isFirst) {
        await pg.query(
          `UPDATE vendor_relationships SET is_primary = FALSE, updated_at = NOW()
            WHERE organization_id = $1 AND vendor_id = $2 AND is_primary`,
          [organizationId, vendorId]
        );
      }
      const inserted = await pg.query<VendorRelationshipRow>(
        `INSERT INTO vendor_relationships
           (organization_id, vendor_id, name, service_description, is_primary, policy_minimum_tier, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${RELATIONSHIP_SELECT}`,
        [organizationId, vendorId, name, str(body.service_description, MAX_DESCRIPTION), wantsPrimary,
         (body.policy_minimum_tier as AssessmentTier | null | undefined) ?? null, userOf(req)]
      );
      writeAuditEvent({
        organizationId, actorUserId: userOf(req),
        eventType: "vendor_relationship.created", resourceType: "vendor", resourceId: vendorId,
        payload: { relationship_id: inserted.rows[0]!.id, name, is_primary: wantsPrimary },
        ipAddress: req.ip ?? null,
      });
      res.status(201).json({ relationship: withState(inserted.rows[0]!) });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({ error: "relationship_already_exists", message: "This vendor already has a relationship with that name." });
        return;
      }
      logger.error({ event: "vendor_relationship_create_failed", organizationId, err }, "Relationship create failed");
      res.status(500).json({ error: "vendor_relationship_create_failed" });
    }
  })
);

/* =========================================================
   GET /api/vendors/:id/relationships/:rid
   ========================================================= */
router.get(
  "/vendors/:id/relationships/:rid",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    try {
      const row = await resolveRelationship(organizationId, String(req.params["id"] ?? ""), String(req.params["rid"] ?? ""));
      if (!row) { res.status(404).json({ error: "relationship_not_found" }); return; }
      res.status(200).json({ relationship: withState(row) });
    } catch (err) {
      logger.error({ event: "vendor_relationship_read_failed", organizationId, err }, "Relationship read failed");
      res.status(500).json({ error: "vendor_relationship_read_failed" });
    }
  })
);

/* =========================================================
   PATCH /api/vendors/:id/relationships/:rid
   name / service_description / status / policy_minimum_tier.
   A policy change on a CLASSIFIED relationship re-resolves the TIER ONLY,
   from the stored bands and the SAME intake version — the peers are not
   recomputed and provenance does not move.
   ========================================================= */
router.patch(
  "/vendors/:id/relationships/:rid",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const vendorId = String(req.params["id"] ?? "");
    const rid = String(req.params["rid"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const current = await resolveRelationship(organizationId, vendorId, rid);
      if (!current) { res.status(404).json({ error: "relationship_not_found" }); return; }

      const sets: string[] = []; const vals: unknown[] = [];
      const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (body.name !== undefined) { const n = str(body.name, MAX_NAME); if (!n) { res.status(400).json({ error: "name_required" }); return; } add("name", n); }
      if (body.service_description !== undefined) add("service_description", str(body.service_description, MAX_DESCRIPTION));
      if (body.status !== undefined) {
        if (body.status !== "active" && body.status !== "inactive") { res.status(400).json({ error: "invalid_status" }); return; }
        add("status", body.status);
      }
      let policyChanged = false;
      let policy: AssessmentTier | null = current.policy_minimum_tier;
      if (body.policy_minimum_tier !== undefined) {
        if (body.policy_minimum_tier !== null && !ASSESSMENT_TIERS.includes(body.policy_minimum_tier as AssessmentTier)) {
          res.status(400).json({ error: "invalid_policy_minimum_tier", allowed: [...ASSESSMENT_TIERS] }); return;
        }
        policy = (body.policy_minimum_tier as AssessmentTier | null);
        policyChanged = policy !== current.policy_minimum_tier;
        add("policy_minimum_tier", policy);
      }
      if (sets.length === 0) { res.status(400).json({ error: "nothing_to_update" }); return; }

      if (policyChanged && current.assessment_tier && current.classification_intake_id) {
        // Re-resolve the tier from the stored peers + the classification's own
        // intake facts. Same intake id, so provenance is unchanged.
        const intake = await pg.query<RelationshipIntakeFacts>(
          `SELECT data_sensitivity, access_level, operational_dependency, concentration
             FROM vendor_relationship_intake WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [current.classification_intake_id, organizationId]
        );
        const f = intake.rows[0]!;
        const tier = resolveAssessmentTier({
          criticality_band: current.criticality_band as never,
          inherent_band: current.inherent_band as never,
          facts: { data_sensitivity: f.data_sensitivity, access_level: f.access_level, operational_dependency: f.operational_dependency, concentration: f.concentration },
          policy_minimum_tier: policy,
        });
        add("assessment_tier", tier.tier);
        add("tier_calculated_minimum", tier.calculated_minimum_tier);
        add("tier_basis", JSON.stringify(tier.basis));
        add("tier_methodology_version", tier.basis.methodology_version);
      }
      vals.push(rid, organizationId, vendorId);
      const updated = await pg.query<VendorRelationshipRow>(
        `UPDATE vendor_relationships SET ${sets.join(", ")}, updated_at = NOW()
          WHERE id = $${vals.length - 2} AND organization_id = $${vals.length - 1} AND vendor_id = $${vals.length}
          RETURNING ${RELATIONSHIP_SELECT}`,
        vals
      );
      writeAuditEvent({
        organizationId, actorUserId: userOf(req),
        eventType: "vendor_relationship.updated", resourceType: "vendor", resourceId: vendorId,
        payload: { relationship_id: rid, fields: Object.keys(body), policy_changed: policyChanged },
        ipAddress: req.ip ?? null,
      });
      res.status(200).json({ relationship: withState(updated.rows[0]!) });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") { res.status(409).json({ error: "relationship_already_exists" }); return; }
      logger.error({ event: "vendor_relationship_update_failed", organizationId, err }, "Relationship update failed");
      res.status(500).json({ error: "vendor_relationship_update_failed" });
    }
  })
);

/* =========================================================
   POST /api/vendors/:id/relationships/:rid/intake
   The ONE factual submission. Appends a version, runs the three engines,
   persists the classification — all in one transaction.
   ========================================================= */
router.post(
  "/vendors/:id/relationships/:rid/intake",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const vendorId = String(req.params["id"] ?? "");
    const rid = String(req.params["rid"] ?? "");
    const v = validateRelationshipIntake(req.body);
    if (!v.ok) { res.status(400).json(v); return; }
    try {
      const rel = await resolveRelationship(organizationId, vendorId, rid);
      if (!rel) { res.status(404).json({ error: "relationship_not_found" }); return; }

      const f = v.facts;
      const inserted = await pg.query<{ id: string; version: number }>(
        `INSERT INTO vendor_relationship_intake
           (organization_id, relationship_id, version,
            max_tolerable_disruption, operational_dependency, business_reach, substitutability, process_coupling, concentration,
            data_sensitivity, data_volume, access_level, regulatory_exposure, regulatory_breach_notification,
            ai_involvement, ai_autonomy, hosting_model, fourth_party_exposure, created_by_user_id)
         VALUES ($1, $2,
                 (SELECT COALESCE(MAX(version), 0) + 1 FROM vendor_relationship_intake WHERE relationship_id = $2),
                 $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id, version`,
        [organizationId, rid,
         f.max_tolerable_disruption, f.operational_dependency, f.business_reach, f.substitutability, f.process_coupling, f.concentration,
         f.data_sensitivity, f.data_volume, f.access_level, f.regulatory_exposure, f.regulatory_breach_notification,
         f.ai_involvement, f.ai_autonomy, f.hosting_model, f.fourth_party_exposure, userOf(req)]
      );
      const intake = inserted.rows[0]!;
      const c = classifyRelationship(f, rel.policy_minimum_tier);

      const updated = await pg.query<VendorRelationshipRow>(
        `UPDATE vendor_relationships SET
           criticality_score = $1, criticality_band = $2, criticality_arithmetic_band = $3, criticality_basis = $4::jsonb, criticality_methodology_version = $5,
           inherent_score = $6, inherent_band = $7, inherent_arithmetic_band = $8, inherent_basis = $9::jsonb, inherent_methodology_version = $10,
           assessment_tier = $11, tier_calculated_minimum = $12, tier_basis = $13::jsonb, tier_methodology_version = $14,
           classification_intake_id = $15, classification_computed_at = NOW(), updated_at = NOW()
         WHERE id = $16 AND organization_id = $17 AND vendor_id = $18
         RETURNING ${RELATIONSHIP_SELECT}`,
        [c.criticality.score, c.criticality.band, c.criticality.arithmetic_band, JSON.stringify(c.criticality.basis), c.criticality.basis.methodology_version,
         c.inherent.score, c.inherent.band, c.inherent.arithmetic_band, JSON.stringify(c.inherent.basis), c.inherent.basis.methodology_version,
         c.tier.tier, c.tier.calculated_minimum_tier, JSON.stringify(c.tier.basis), c.tier.basis.methodology_version,
         intake.id, rid, organizationId, vendorId]
      );
      writeAuditEvent({
        organizationId, actorUserId: userOf(req),
        eventType: "vendor_relationship.classified", resourceType: "vendor", resourceId: vendorId,
        payload: {
          relationship_id: rid, intake_id: intake.id, intake_version: intake.version,
          criticality: { score: c.criticality.score, band: c.criticality.band },
          inherent: { score: c.inherent.score, band: c.inherent.band },
          assessment_tier: c.tier.tier, tier_calculated_minimum: c.tier.calculated_minimum_tier,
        },
        ipAddress: req.ip ?? null,
      });
      res.status(201).json({ intake: { id: intake.id, version: intake.version }, relationship: withState(updated.rows[0]!) });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({ error: "intake_conflict", message: "Another intake was recorded at the same moment. Re-read and try again." });
        return;
      }
      logger.error({ event: "vendor_relationship_intake_failed", organizationId, err }, "Relationship intake failed");
      res.status(500).json({ error: "vendor_relationship_intake_failed" });
    }
  })
);

/* =========================================================
   GET /api/vendors/:id/relationships/:rid/intake — the version history
   ========================================================= */
router.get(
  "/vendors/:id/relationships/:rid/intake",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const vendorId = String(req.params["id"] ?? "");
    const rid = String(req.params["rid"] ?? "");
    try {
      const rel = await resolveRelationship(organizationId, vendorId, rid);
      if (!rel) { res.status(404).json({ error: "relationship_not_found" }); return; }
      const rows = await pg.query(
        `SELECT id, version, max_tolerable_disruption, operational_dependency, business_reach, substitutability, process_coupling, concentration,
                data_sensitivity, data_volume, access_level, regulatory_exposure, regulatory_breach_notification,
                ai_involvement, ai_autonomy, hosting_model, fourth_party_exposure, created_by_user_id, created_at
           FROM vendor_relationship_intake WHERE organization_id = $1 AND relationship_id = $2 ORDER BY version DESC`,
        [organizationId, rid]
      );
      res.status(200).json({ intake: rows.rows, count: rows.rowCount, current_version: rows.rows[0]?.version ?? null });
    } catch (err) {
      logger.error({ event: "vendor_relationship_intake_list_failed", organizationId, err }, "Intake history failed");
      res.status(500).json({ error: "vendor_relationship_intake_list_failed" });
    }
  })
);

export default router;
