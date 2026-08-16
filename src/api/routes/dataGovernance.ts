/**
 * dataGovernance.ts — the customer-facing Tenant Data Governance surface.
 *
 * Class-agnostic by construction: every route takes `:dataClass` as a path
 * parameter and resolves it through the registry. Governing a new data class
 * adds no route here (invariant TDG-15).
 *
 * THREE PLANES, and the separation is the point:
 *
 *   metadata — administrators see id, owner, age, hold state. Never content.
 *   action   — administrators set policy, place/release holds, delete objects.
 *   content  — NOT BUILT. An administrator can destroy a conversation they have
 *              no right to read, because deletion never requires reading. Adding
 *              content access later is easy; withdrawing it is not.
 *
 * The whole router is dark behind SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED:
 * with the flag off every path 404s, exactly as if it did not ship.
 */

import { Router, type Request, type Response } from "express";
import { withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdminRole } from "../middleware/requireRole.js";
import { tdgFeatureFlag } from "../middleware/tdgFeatureFlag.js";
import {
  getDataClass,
  listDataClasses,
  type GovernedDataClass
} from "../lib/governance/dataClasses.js";
import { getClassHandler } from "../lib/governance/classHandlers.js";
import {
  listPolicyVersions,
  listAllPolicyVersions,
  insertPolicyVersion,
  listHolds,
  listActiveHolds,
  findHold,
  insertHold,
  releaseHold
} from "../lib/governance/governanceStore.js";
import {
  resolveEffectivePolicy,
  validatePolicyWrite,
  type EffectivePolicy
} from "../lib/governance/retentionPolicy.js";
import { holdCovering } from "../lib/governance/holdPredicate.js";
import {
  canPlaceHold,
  canReleaseHold,
  statusForHoldReason
} from "../lib/governance/legalHoldAuthority.js";
import {
  activationBlockers,
  TDG_GRACE_DAYS,
  tdgEffectiveFrom
} from "../lib/governance/tdgPolicy.js";
import {
  recordGovernanceEvent,
  GOVERNANCE_EVENT_TYPES
} from "../lib/governance/governanceAudit.js";
import {
  planSweep,
  deleteGovernedObject,
  SWEEP_BATCH_LIMIT
} from "../lib/governance/retentionService.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a registered class or answer 404. Never guesses a default. */
function requireClass(req: Request, res: Response): GovernedDataClass | null {
  const key = String(req.params["dataClass"] ?? "");
  const dataClass = getDataClass(key);
  if (!dataClass) {
    res.status(404).json({ error: "unknown_data_class" });
    return null;
  }
  return dataClass;
}

async function effectiveFor(
  organizationId: string,
  dataClass: GovernedDataClass,
  now: Date
): Promise<EffectivePolicy> {
  const versions = await listPolicyVersions(organizationId, dataClass.key);
  return resolveEffectivePolicy(dataClass, versions, now);
}

/* =========================================================
   GET /api/governance/classes
   The registry as the customer sees it: what is governed, the bounds they may
   choose within, and the policy in force for each class.
   ========================================================= */

router.get("/governance/classes", tdgFeatureFlag, requireAuth, async (req, res) => {
  const orgId = req.jwtPayload!.org;
  try {
    const now = new Date();
    const classes = await withTenant(orgId, async () =>
      Promise.all(
        listDataClasses().map(async (c) => ({
          key: c.key,
          label: c.label,
          defaultDays: c.defaultDays,
          minDays: c.minDays,
          maxDays: c.maxDays,
          tenantConfigurable: c.tenantConfigurable,
          dependsOn: c.dependsOn,
          erasureDisposition: c.erasureDisposition,
          effective: await effectiveFor(orgId, c, now)
        }))
      )
    );
    res.status(200).json({
      classes,
      activation: {
        blockers: activationBlockers(),
        effectiveFrom: tdgEffectiveFrom()?.toISOString() ?? null,
        graceDays: TDG_GRACE_DAYS
      }
    });
  } catch (err) {
    logger.error({ event: "tdg_classes_failed", orgId, err }, "TDG class listing failed");
    res.status(500).json({ error: "governance_read_failed" });
  }
});

/* =========================================================
   GET /api/governance/retention
   Every policy version the org holds. Append-only, so this IS the history.
   ========================================================= */

router.get("/governance/retention", tdgFeatureFlag, requireAuth, async (req, res) => {
  const orgId = req.jwtPayload!.org;
  try {
    const versions = await withTenant(orgId, () => listAllPolicyVersions(orgId));
    res.status(200).json({ versions });
  } catch (err) {
    logger.error({ event: "tdg_policy_history_failed", orgId, err }, "TDG policy history failed");
    res.status(500).json({ error: "governance_read_failed" });
  }
});

/* =========================================================
   PUT /api/governance/retention/:dataClass
   Admin. Appends a new policy version — never updates one.
   Body: { retentionDays: number } | { cleared: true }, plus optional reason.
   ========================================================= */

router.put(
  "/governance/retention/:dataClass",
  tdgFeatureFlag,
  requireAuth,
  requireAdminRole,
  async (req, res) => {
    const orgId = req.jwtPayload!.org;
    const actorUserId = req.jwtPayload!.sub;
    const dataClass = requireClass(req, res);
    if (!dataClass) return;

    const body = (req.body ?? {}) as { retentionDays?: unknown; cleared?: unknown; reason?: unknown };
    const cleared = body.cleared === true;
    const reason = typeof body.reason === "string" ? body.reason : null;

    try {
      const now = new Date();
      const result = await withTenant(orgId, async () => {
        const previous = await effectiveFor(orgId, dataClass, now);

        if (!cleared) {
          // Dependencies are resolved for THIS org, so the check is against the
          // ledger period actually in force here — not a constant.
          const depPolicies = new Map<string, EffectivePolicy>();
          for (const depKey of dataClass.dependsOn) {
            const dep = getDataClass(depKey);
            if (dep) depPolicies.set(depKey, await effectiveFor(orgId, dep, now));
          }
          const validation = validatePolicyWrite(dataClass, body.retentionDays, (k) =>
            depPolicies.get(k) ?? null
          );
          if (!validation.ok) {
            return { status: 400, body: { error: validation.code, detail: validation.message } };
          }
        } else if (!dataClass.tenantConfigurable) {
          return {
            status: 400,
            body: { error: "class_not_configurable", detail: `${dataClass.key} has no tenant override to clear` }
          };
        }

        const inserted = await insertPolicyVersion({
          organizationId: orgId,
          dataClass: dataClass.key,
          retentionDays: cleared ? null : (body.retentionDays as number),
          cleared,
          source: "tenant",
          setByUserId: actorUserId,
          reason
        });

        await recordGovernanceEvent({
          organizationId: orgId,
          actorUserId,
          resourceType: "retention_policy",
          resourceId: inserted.id,
          ipAddress: req.ip ?? null,
          event: {
            type: GOVERNANCE_EVENT_TYPES.policyChanged,
            data: {
              dataClass: dataClass.key,
              previousDays: previous.retentionDays,
              previousSource: previous.source,
              newDays: inserted.retentionDays,
              newSource: cleared ? "platform_default" : inserted.source,
              cleared,
              version: inserted.version
            }
          }
        });

        const effective = await effectiveFor(orgId, dataClass, now);
        return { status: 200, body: { policy: inserted, effective } };
      });

      res.status(result.status).json(result.body);
    } catch (err) {
      logger.error({ event: "tdg_policy_write_failed", orgId, err }, "TDG policy write failed");
      res.status(500).json({ error: "governance_write_failed" });
    }
  }
);

/* =========================================================
   Legal holds
   ========================================================= */

router.get("/governance/holds", tdgFeatureFlag, requireAuth, requireAdminRole, async (req, res) => {
  const orgId = req.jwtPayload!.org;
  try {
    const holds = await withTenant(orgId, () => listHolds(orgId));
    res.status(200).json({ holds });
  } catch (err) {
    logger.error({ event: "tdg_hold_list_failed", orgId, err }, "TDG hold listing failed");
    res.status(500).json({ error: "governance_read_failed" });
  }
});

router.post("/governance/holds", tdgFeatureFlag, requireAuth, requireAdminRole, async (req, res) => {
  const orgId = req.jwtPayload!.org;
  const actorUserId = req.jwtPayload!.sub;
  const actorRole = req.userRole ?? req.jwtPayload!.role ?? null;

  const body = (req.body ?? {}) as {
    scopeType?: unknown;
    dataClass?: unknown;
    subjectUserId?: unknown;
    objectId?: unknown;
    reason?: unknown;
  };

  const decision = canPlaceHold({
    actorUserId,
    actorRole,
    reason: typeof body.reason === "string" ? body.reason : null
  });
  if (!decision.allowed) {
    res.status(statusForHoldReason(decision.reason!)).json({ error: decision.reason });
    return;
  }

  const scopeType = String(body.scopeType ?? "");
  if (!["organization", "data_class", "subject_user", "object"].includes(scopeType)) {
    res.status(400).json({ error: "invalid_scope_type" });
    return;
  }

  const dataClassKey = typeof body.dataClass === "string" ? body.dataClass : null;
  if ((scopeType === "data_class" || scopeType === "object") && !getDataClass(dataClassKey ?? "")) {
    res.status(400).json({ error: "unknown_data_class" });
    return;
  }
  const subjectUserId = typeof body.subjectUserId === "string" ? body.subjectUserId : null;
  const objectId = typeof body.objectId === "string" ? body.objectId : null;
  if (scopeType === "subject_user" && (!subjectUserId || !UUID_RE.test(subjectUserId))) {
    res.status(400).json({ error: "subject_user_id_required" });
    return;
  }
  if (scopeType === "object" && (!objectId || !UUID_RE.test(objectId))) {
    res.status(400).json({ error: "object_id_required" });
    return;
  }

  try {
    const hold = await withTenant(orgId, async () => {
      const created = await insertHold({
        organizationId: orgId,
        scopeType: scopeType as "organization" | "data_class" | "subject_user" | "object",
        dataClass: scopeType === "data_class" || scopeType === "object" ? dataClassKey : null,
        subjectUserId: scopeType === "subject_user" ? subjectUserId : null,
        objectId: scopeType === "object" ? objectId : null,
        reason: String(body.reason),
        placedByUserId: actorUserId
      });

      await recordGovernanceEvent({
        organizationId: orgId,
        actorUserId,
        resourceType: "legal_hold",
        resourceId: created.id,
        ipAddress: req.ip ?? null,
        event: {
          type: GOVERNANCE_EVENT_TYPES.holdPlaced,
          data: {
            scopeType: created.scopeType,
            dataClass: created.dataClass,
            subjectUserId: created.subjectUserId,
            objectId: created.objectId,
            reason: created.reason,
            placedByUserId: created.placedByUserId
          }
        }
      });

      return created;
    });

    res.status(201).json({ hold });
  } catch (err) {
    logger.error({ event: "tdg_hold_place_failed", orgId, err }, "TDG hold placement failed");
    res.status(500).json({ error: "governance_write_failed" });
  }
});

/**
 * Release. Separation of duties is checked HERE against the stored placer, and
 * again by the DB CHECK — the route can be bypassed by a future caller, the
 * constraint cannot.
 */
router.post(
  "/governance/holds/:id/release",
  tdgFeatureFlag,
  requireAuth,
  requireAdminRole,
  async (req, res) => {
    const orgId = req.jwtPayload!.org;
    const actorUserId = req.jwtPayload!.sub;
    const actorRole = req.userRole ?? req.jwtPayload!.role ?? null;
    const holdId = String(req.params["id"] ?? "");
    if (!UUID_RE.test(holdId)) {
      res.status(404).json({ error: "hold_not_found" });
      return;
    }
    const reason = (req.body ?? {}).reason;

    try {
      const result = await withTenant(orgId, async () => {
        const existing = await findHold(orgId, holdId);
        if (!existing) return { status: 404, body: { error: "hold_not_found" } };
        if (existing.status !== "active") {
          return { status: 409, body: { error: "hold_not_active" } };
        }

        const decision = canReleaseHold({
          actorUserId,
          actorRole,
          reason: typeof reason === "string" ? reason : null,
          placedByUserId: existing.placedByUserId
        });
        if (!decision.allowed) {
          return { status: statusForHoldReason(decision.reason!), body: { error: decision.reason } };
        }

        const released = await releaseHold({
          organizationId: orgId,
          holdId,
          releasedByUserId: actorUserId,
          releaseReason: String(reason)
        });
        if (!released) return { status: 409, body: { error: "hold_not_active" } };

        await recordGovernanceEvent({
          organizationId: orgId,
          actorUserId,
          resourceType: "legal_hold",
          resourceId: released.id,
          ipAddress: req.ip ?? null,
          event: {
            type: GOVERNANCE_EVENT_TYPES.holdReleased,
            data: {
              scopeType: released.scopeType,
              dataClass: released.dataClass,
              subjectUserId: released.subjectUserId,
              objectId: released.objectId,
              reason: released.reason,
              placedByUserId: released.placedByUserId,
              releaseReason: String(reason)
            }
          }
        });

        return { status: 200, body: { hold: released } };
      });

      res.status(result.status).json(result.body);
    } catch (err) {
      logger.error({ event: "tdg_hold_release_failed", orgId, err }, "TDG hold release failed");
      res.status(500).json({ error: "governance_write_failed" });
    }
  }
);

/* =========================================================
   GET /api/governance/objects/:dataClass
   The METADATA plane. Identity, owner, age, hold state — no content, ever.
   ========================================================= */

router.get(
  "/governance/objects/:dataClass",
  tdgFeatureFlag,
  requireAuth,
  requireAdminRole,
  async (req, res) => {
    const orgId = req.jwtPayload!.org;
    const dataClass = requireClass(req, res);
    if (!dataClass) return;
    const handler = getClassHandler(dataClass.key);
    if (!handler) {
      res.status(404).json({ error: "unknown_data_class" });
      return;
    }

    const limit = Math.min(Number(req.query["limit"] ?? 50) || 50, 200);
    const offset = Math.max(Number(req.query["offset"] ?? 0) || 0, 0);

    try {
      const payload = await withTenant(orgId, async () => {
        const objects = await handler.listObjects(orgId, limit, offset);
        const holds = await listActiveHolds(orgId);
        return objects.map((o) => ({
          id: o.id,
          ownerUserId: o.ownerUserId,
          ageAnchor: o.ageAnchor,
          heldBy: holdCovering(holds, {
            dataClass: dataClass.key,
            objectId: o.id,
            ownerUserId: o.ownerUserId
          })
        }));
      });
      res.status(200).json({ dataClass: dataClass.key, objects: payload, limit, offset });
    } catch (err) {
      logger.error({ event: "tdg_object_list_failed", orgId, err }, "TDG object listing failed");
      res.status(500).json({ error: "governance_read_failed" });
    }
  }
);

/* =========================================================
   DELETE /api/governance/objects/:dataClass/:id
   The ACTION plane. Administrator deletion without read access.
   ========================================================= */

router.delete(
  "/governance/objects/:dataClass/:id",
  tdgFeatureFlag,
  requireAuth,
  requireAdminRole,
  async (req, res) => {
    const orgId = req.jwtPayload!.org;
    const actorUserId = req.jwtPayload!.sub;
    const dataClass = requireClass(req, res);
    if (!dataClass) return;
    const objectId = String(req.params["id"] ?? "");
    if (!UUID_RE.test(objectId)) {
      res.status(404).json({ error: "object_not_found" });
      return;
    }

    try {
      const outcome = await withTenant(orgId, () =>
        deleteGovernedObject({
          organizationId: orgId,
          dataClassKey: dataClass.key,
          objectId,
          actorUserId,
          requireOwnerUserId: null,
          trigger: "administrator",
          ipAddress: req.ip ?? null
        })
      );

      switch (outcome.outcome) {
        case "deleted":
          res.status(200).json({ deleted: true, counts: outcome.counts });
          return;
        case "held":
          res.status(409).json({ error: "legal_hold_active", holdId: outcome.holdId });
          return;
        default:
          res.status(404).json({ error: "object_not_found" });
      }
    } catch (err) {
      logger.error({ event: "tdg_object_delete_failed", orgId, err }, "TDG object deletion failed");
      res.status(500).json({ error: "governance_delete_failed" });
    }
  }
);

/* =========================================================
   GET /api/governance/sweep/:dataClass/preview
   Dry run. Reads only — planning never writes, which is what makes this
   trustworthy as the pre-activation report rather than a rehearsal.
   ========================================================= */

router.get(
  "/governance/sweep/:dataClass/preview",
  tdgFeatureFlag,
  requireAuth,
  requireAdminRole,
  async (req, res) => {
    const orgId = req.jwtPayload!.org;
    const dataClass = requireClass(req, res);
    if (!dataClass) return;

    try {
      const plan = await withTenant(orgId, () =>
        planSweep({ organizationId: orgId, dataClassKey: dataClass.key, limit: SWEEP_BATCH_LIMIT })
      );
      if (!plan) {
        res.status(404).json({ error: "unknown_data_class" });
        return;
      }
      res.status(200).json({
        dataClass: plan.dataClass.key,
        policy: plan.policy,
        cutoff: plan.cutoff.toISOString(),
        totalGoverned: plan.totalGoverned,
        eligibleCount: plan.eligible.length,
        suppressedByHoldCount: plan.suppressed.length,
        deletableCount: plan.deletable.length,
        blockers: plan.blockers,
        batchLimit: SWEEP_BATCH_LIMIT
      });
    } catch (err) {
      logger.error({ event: "tdg_sweep_preview_failed", orgId, err }, "TDG sweep preview failed");
      res.status(500).json({ error: "governance_read_failed" });
    }
  }
);

export default router;
