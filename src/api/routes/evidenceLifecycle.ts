/**
 * evidenceLifecycle.ts — the customer-operable surface for governed evidence.
 *
 * VA-S4. Steps 2 and 3 landed the substrate with NO writer, deliberately, so
 * the rules could be argued about before anything depended on them. This is the
 * surface a reviewer and a customer actually use, and it is the only route file
 * permitted to mutate an evidence artifact's governance envelope.
 *
 * WHY A SEPARATE FILE FROM evidence.ts
 *   evidence.ts states "Evidence records are write-once. There is no PATCH and
 *   no DELETE route", and that stays true there. Curation, linking and
 *   withdrawal are governed lifecycle operations with their own authority
 *   rules, not CRUD on the record, so they live apart rather than eroding a
 *   promise another file makes.
 *
 * AUTHORITY, ON EVERY ROUTE
 *   requireApiKey establishes PERMISSION. requireHumanReviewer establishes
 *   HUMAN AUTHORITY, and an API key alone never satisfies it — scopeForApiKey()
 *   resolves a key to a full seat, so a machine caller holds every capability a
 *   person does. Confirming, curating and withdrawing are all governance acts
 *   and all name the person who made them.
 *
 * THE FLAG
 *   Every route here is behind SECURELOGIC_EVIDENCE_LIFECYCLE_V2, default-off
 *   and undeclared in IaC. The flag does not gate the counting predicate — that
 *   is still unwired — it gates whether this surface exists at all.
 *
 * Routes:
 *   POST /api/evidence/:id/links                     — record a use
 *   GET  /api/evidence/:id/links                     — what this artifact is used for
 *   POST /api/evidence/links/:linkId/confirm         — the act that makes a use COUNT
 *   POST /api/evidence/links/:linkId/detach          — end a use
 *   POST /api/evidence/:id/assurance                 — establish class + validity (write-once)
 *   POST /api/evidence/:id/withdraw                  — governed destruction
 *   GET  /api/organization/evidence-validity-settings          — D15, read
 *   PUT  /api/organization/evidence-validity-settings/:class   — D15, set
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { asTenant } from "../middleware/asTenant.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { requireHumanReviewer } from "../lib/humanReviewer.js";
import { evidenceLifecycleV2Enabled } from "../lib/evidenceLifecycleFlag.js";
import {
  linkEvidence, confirmLink, detachLink, establishAssurance, loadEffectivePolicy,
  isTargetType, isLinkKind, isDetachReason, isAssuranceClass,
  EVIDENCE_DETACH_REASONS, type WriterFailure,
} from "../lib/evidenceLinkWriter.js";
import { EVIDENCE_LINK_TARGET_TYPES, EVIDENCE_LINK_KINDS, EVIDENCE_ASSURANCE_CLASSES } from "../lib/evidenceLifecycleContract.js";

const router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The flag gate. 404, not 403: while the surface is dark it does not exist, and
 * a 403 would advertise that it does.
 */
function requireLifecycleV2(_req: Request, res: Response, next: NextFunction): void {
  if (!evidenceLifecycleV2Enabled(process.env)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}

function orgIdOf(req: Request): string | null {
  return (req as { organizationContext?: { organizationId?: string | null } })
    .organizationContext?.organizationId ?? null;
}

/** One place mapping writer slugs to statuses, so no route invents its own. */
const FAILURE_STATUS: Record<WriterFailure, number> = {
  evidence_not_found: 404,
  link_not_found: 404,
  link_already_confirmed: 409,
  link_already_detached: 409,
  link_not_confirmed: 409,
  requirement_grain_not_allowed: 400,
  duplicate_live_link: 409,
  assurance_class_already_established: 409,
  validity_already_established: 409,
  no_ratified_policy: 422,
  policy_establishes_no_window: 422,
  no_anchor_date: 422,
  customer_duration_exceeds_ceiling: 400,
  customer_duration_invalid: 400,
};

const GATE = [requireApiKey, attachOrganizationContext, requirePremiumOrCorePlatform, denyContributor(), requireLifecycleV2] as const;

/* =========================================================
   POST /api/evidence/:id/links — record a USE of an artifact.
   Deliberately creates an UNCONFIRMED link: offering an artifact and judging
   it sufficient are different acts by different people at different times.
   ========================================================= */
router.post("/evidence/:id/links", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const actor = requireHumanReviewer(req, res, "Recording an evidence link");
  if (!actor) return;

  const evidenceId = String(req.params["id"] ?? "").trim();
  if (!UUID.test(evidenceId)) { res.status(400).json({ error: "evidence_id_must_be_uuid" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isTargetType(body["target_type"])) {
    res.status(400).json({ error: "target_type_invalid", allowed: EVIDENCE_LINK_TARGET_TYPES }); return;
  }
  const targetId = String(body["target_id"] ?? "").trim();
  if (!UUID.test(targetId)) { res.status(400).json({ error: "target_id_must_be_uuid" }); return; }
  if (!isLinkKind(body["link_kind"])) {
    res.status(400).json({ error: "link_kind_invalid", allowed: EVIDENCE_LINK_KINDS }); return;
  }
  const reqIdRaw = body["target_requirement_id"];
  let targetRequirementId: string | null = null;
  if (reqIdRaw !== undefined && reqIdRaw !== null) {
    targetRequirementId = String(reqIdRaw).trim();
    if (!UUID.test(targetRequirementId)) { res.status(400).json({ error: "target_requirement_id_must_be_uuid" }); return; }
  }

  try {
    const out = await linkEvidence({
      organizationId, evidenceId, targetType: body["target_type"], targetId,
      targetRequirementId, linkKind: body["link_kind"], actorUserId: actor,
    });
    if (!out.ok) { res.status(FAILURE_STATUS[out.reason]).json({ error: out.reason, detail: out.detail }); return; }
    res.status(201).json({ link_id: out.value.linkId, confirmed: false,
      detail: "Recorded as a use. It does not count until a human confirms it in this context." });
  } catch (err) {
    logger.error({ event: "evidence_link_failed", err }, "Evidence link failed");
    res.status(500).json({ error: "evidence_link_failed" });
  }
}));

/* =========================================================
   GET /api/evidence/:id/links — every use of this artifact, live and historic.
   ========================================================= */
router.get("/evidence/:id/links", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const evidenceId = String(req.params["id"] ?? "").trim();
  if (!UUID.test(evidenceId)) { res.status(400).json({ error: "evidence_id_must_be_uuid" }); return; }

  try {
    const r = await pg.query(
      `SELECT id, target_type, target_id, target_requirement_id, link_kind,
              linked_at, linked_by_user_id, confirmed_at, confirmed_by_user_id,
              confirmation_note, detached_at, detached_by_user_id, detach_reason
         FROM evidence_links
        WHERE evidence_id = $1 AND organization_id = $2
        ORDER BY linked_at DESC`,
      [evidenceId, organizationId]
    );
    res.status(200).json({
      links: r.rows.map((row) => ({
        ...row,
        // Stated rather than inferred by the caller: a link counts only while
        // it is confirmed AND not detached.
        counts: row.confirmed_at !== null && row.detached_at === null,
      })),
    });
  } catch (err) {
    logger.error({ event: "evidence_links_list_failed", err }, "Evidence link list failed");
    res.status(500).json({ error: "evidence_links_unavailable" });
  }
}));

/* =========================================================
   POST /api/evidence/links/:linkId/confirm — the act that makes a use COUNT.
   ========================================================= */
router.post("/evidence/links/:linkId/confirm", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const actor = requireHumanReviewer(req, res, "Confirming that evidence assures this requirement");
  if (!actor) return;

  const linkId = String(req.params["linkId"] ?? "").trim();
  if (!UUID.test(linkId)) { res.status(400).json({ error: "link_id_must_be_uuid" }); return; }

  const note = String(((req.body ?? {}) as Record<string, unknown>)["note"] ?? "").trim();
  if (note === "") {
    res.status(400).json({ error: "confirmation_note_required",
      detail: "Confirmation is all-or-none: a timestamp, a person, and what they judged." });
    return;
  }

  try {
    const out = await confirmLink({ organizationId, linkId, actorUserId: actor, note });
    if (!out.ok) { res.status(FAILURE_STATUS[out.reason]).json({ error: out.reason, detail: out.detail }); return; }
    res.status(200).json({ link_id: linkId, counts: true });
  } catch (err) {
    logger.error({ event: "evidence_link_confirm_failed", err }, "Evidence link confirm failed");
    res.status(500).json({ error: "evidence_link_confirm_failed" });
  }
}));

/* =========================================================
   POST /api/evidence/links/:linkId/detach — end a use. Terminal.
   ========================================================= */
router.post("/evidence/links/:linkId/detach", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const actor = requireHumanReviewer(req, res, "Detaching evidence from this context");
  if (!actor) return;

  const linkId = String(req.params["linkId"] ?? "").trim();
  if (!UUID.test(linkId)) { res.status(400).json({ error: "link_id_must_be_uuid" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isDetachReason(body["reason"])) {
    res.status(400).json({ error: "detach_reason_invalid", allowed: EVIDENCE_DETACH_REASONS }); return;
  }
  const noteRaw = body["note"];
  const note = typeof noteRaw === "string" ? noteRaw.trim() : null;

  try {
    const out = await detachLink({ organizationId, linkId, actorUserId: actor, reason: body["reason"], note });
    if (!out.ok) { res.status(FAILURE_STATUS[out.reason]).json({ error: out.reason, detail: out.detail }); return; }
    res.status(200).json({ link_id: linkId, counts: false });
  } catch (err) {
    logger.error({ event: "evidence_link_detach_failed", err }, "Evidence link detach failed");
    res.status(500).json({ error: "evidence_link_detach_failed" });
  }
}));

/* =========================================================
   POST /api/evidence/:id/assurance — establish class + validity. WRITE-ONCE.

   This is the curation path Step 2 said was OWED: the legacy estate is
   'unclassified' + 'not_established' and counts for nothing until a human says
   what each artifact is. The database enforces write-once independently
   (20261084) — to change what an artifact asserts, supersede it.
   ========================================================= */
router.post("/evidence/:id/assurance", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const actor = requireHumanReviewer(req, res, "Establishing what an evidence artifact is and how long it is good for");
  if (!actor) return;

  const evidenceId = String(req.params["id"] ?? "").trim();
  if (!UUID.test(evidenceId)) { res.status(400).json({ error: "evidence_id_must_be_uuid" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isAssuranceClass(body["assurance_class"]) || body["assurance_class"] === "unclassified") {
    res.status(400).json({ error: "assurance_class_invalid",
      allowed: EVIDENCE_ASSURANCE_CLASSES.filter((c) => c !== "unclassified") });
    return;
  }
  const anchorRaw = body["anchor_date"];
  const anchorDate = typeof anchorRaw === "string" && ISO_DATE.test(anchorRaw.trim()) ? anchorRaw.trim() : null;
  const assertedRaw = body["artifact_asserted_until"];
  const artifactAssertedUntil =
    typeof assertedRaw === "string" && ISO_DATE.test(assertedRaw.trim()) ? assertedRaw.trim() : null;

  try {
    const out = await establishAssurance({
      organizationId, evidenceId, assuranceClass: body["assurance_class"],
      anchorDate, artifactAssertedUntil, actorUserId: actor,
    });
    if (!out.ok) { res.status(FAILURE_STATUS[out.reason]).json({ error: out.reason, detail: out.detail }); return; }
    res.status(200).json({
      assurance_class: body["assurance_class"],
      validity_basis: out.value.validityBasis,
      valid_until: out.value.validUntil,
      reason: out.value.reason,
      // Said out loud: a class without a window is a normal, honest outcome.
      counts_toward_assurance: out.value.validityBasis === "policy_default",
    });
  } catch (err) {
    logger.error({ event: "evidence_assurance_establish_failed", err }, "Establishing evidence assurance failed");
    res.status(500).json({ error: "evidence_assurance_establish_failed" });
  }
}));

/* =========================================================
   POST /api/evidence/:id/withdraw — governed destruction (owner ruling
   2026-09-01): detach all links, record events, then delete.

   Internal reviewers only. The vendor portal deliberately cannot reach this:
   a vendor able to destroy evidence a reviewer confirmed could delete
   inconvenient proof after the fact.
   ========================================================= */
router.post("/evidence/:id/withdraw", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const actor = requireHumanReviewer(req, res, "Withdrawing an evidence artifact");
  if (!actor) return;

  const evidenceId = String(req.params["id"] ?? "").trim();
  if (!UUID.test(evidenceId)) { res.status(400).json({ error: "evidence_id_must_be_uuid" }); return; }

  const reason = String(((req.body ?? {}) as Record<string, unknown>)["reason"] ?? "").trim();
  if (reason === "") {
    res.status(400).json({ error: "withdrawal_reason_required",
      detail: "Destroying an artifact is irreversible and must say why. The reason is the only record that survives." });
    return;
  }

  try {
    const r = await pg.query<{ links_detached: number; links_removed: number }>(
      `SELECT links_detached, links_removed FROM withdraw_evidence($1,$2,$3)`,
      [evidenceId, actor, reason]
    );
    res.status(200).json({
      withdrawn: true,
      links_detached: Number(r.rows[0]?.links_detached ?? 0),
      links_removed: Number(r.rows[0]?.links_removed ?? 0),
    });
  } catch (err) {
    const msg = String((err as Error).message ?? "");
    // The function's own refusals, surfaced as themselves rather than a 500.
    if (msg.includes("evidence_not_found")) { res.status(404).json({ error: "evidence_not_found" }); return; }
    if (msg.includes("evidence_is_superseded_by_another_version")) {
      res.status(409).json({ error: "evidence_is_superseded_by_another_version",
        detail: "A later version references this artifact. Withdraw the newer version first." });
      return;
    }
    if (msg.includes("withdrawal_requires_a_reason")) { res.status(400).json({ error: "withdrawal_reason_required" }); return; }
    if (msg.includes("actor_not_in_organization") || msg.includes("withdrawal_requires_an_actor")) {
      res.status(403).json({ error: "human_reviewer_required" }); return;
    }
    logger.error({ event: "evidence_withdraw_failed", err }, "Evidence withdrawal failed");
    res.status(500).json({ error: "evidence_withdraw_failed" });
  }
}));

/* =========================================================
   D15 — the customer's own validity position.

   Step 3 ratified this and shipped only the data layer; nothing let a customer
   set a value, which was recorded as a CUSTOMER-OPERABILITY GAP. This closes it.
   ========================================================= */
router.get("/organization/evidence-validity-settings", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  try {
    const r = await pg.query(
      `SELECT p.assurance_class,
              p.default_duration_months AS platform_default_months,
              p.max_duration_months     AS platform_max_months,
              p.anchor,
              s.duration_months         AS your_months,
              s.reason                  AS your_reason,
              s.version                 AS your_version
         FROM evidence_validity_policy p
         LEFT JOIN organization_evidence_validity_settings s
           ON s.assurance_class = p.assurance_class
          AND s.organization_id = $1
          AND s.superseded_at IS NULL
        WHERE p.superseded_at IS NULL
        ORDER BY p.assurance_class`,
      [organizationId]
    );
    res.status(200).json({
      settings: r.rows.map((row) => ({
        ...row,
        effective_months: row.your_months ?? row.platform_default_months,
        // Stated so the UI need not re-derive the rule: tighten freely, loosen
        // only to the ceiling, and a class with no ratified duration cannot be
        // configured at all.
        configurable: row.platform_max_months !== null,
      })),
    });
  } catch (err) {
    logger.error({ event: "evidence_validity_settings_list_failed", err }, "Validity settings read failed");
    res.status(500).json({ error: "evidence_validity_settings_unavailable" });
  }
}));

router.put("/organization/evidence-validity-settings/:assuranceClass", ...GATE, asTenant(async (req, res) => {
  const organizationId = orgIdOf(req);
  if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
  const actor = requireHumanReviewer(req, res, "Setting this organization's evidence-validity position");
  if (!actor) return;

  const assuranceClass = String(req.params["assuranceClass"] ?? "").trim();
  if (!isAssuranceClass(assuranceClass) || assuranceClass === "unclassified") {
    res.status(400).json({ error: "assurance_class_invalid" }); return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const months = Number(body["duration_months"]);
  if (!Number.isInteger(months) || months < 1) {
    res.status(400).json({ error: "duration_months_invalid", detail: "A whole number of months, at least 1." });
    return;
  }
  const reason = String(body["reason"] ?? "").trim();
  if (reason === "") { res.status(400).json({ error: "reason_required" }); return; }

  try {
    const { policy } = await loadEffectivePolicy(organizationId, assuranceClass);
    if (!policy) {
      res.status(422).json({ error: "no_ratified_policy",
        detail: "This assurance class has no ratified platform policy, so there is nothing to configure against." });
      return;
    }
    if (policy.maxDurationMonths === null) {
      res.status(422).json({ error: "policy_establishes_no_window",
        detail: "This class has a policy but no ratified duration, so there is no ceiling to configure against." });
      return;
    }
    if (months > policy.maxDurationMonths) {
      res.status(400).json({ error: "customer_duration_exceeds_ceiling", ceiling_months: policy.maxDurationMonths,
        detail: "You may tighten freely; loosening is bounded by the platform ceiling." });
      return;
    }

    // Append-and-supersede: two statements, never a data-modifying CTE. One CTE
    // shares a single snapshot, so the partial unique index would still see the
    // old live row and the second write would collide.
    const prior = await pg.query<{ version: number }>(
      `UPDATE organization_evidence_validity_settings
          SET superseded_at = NOW()
        WHERE organization_id = $1 AND assurance_class = $2 AND superseded_at IS NULL
        RETURNING version`,
      [organizationId, assuranceClass]
    );
    const nextVersion = (prior.rows[0]?.version ?? 0) + 1;
    await pg.query(
      `INSERT INTO organization_evidence_validity_settings
         (organization_id, assurance_class, duration_months, version, set_by_user_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [organizationId, assuranceClass, months, nextVersion, actor, reason]
    );
    res.status(200).json({ assurance_class: assuranceClass, duration_months: months, version: nextVersion });
  } catch (err) {
    logger.error({ event: "evidence_validity_setting_write_failed", err }, "Validity setting write failed");
    res.status(500).json({ error: "evidence_validity_setting_write_failed" });
  }
}));

export default router;
