/**
 * findingRiskLinks.ts — the relationship between a Finding and the Risk Register.
 *
 * THE GAP THIS CLOSES. Findings and risks both existed, and neither could point
 * at the other. `risks.source_type='finding'` looks like the answer and is not:
 * it is single-valued, so one risk can name one origin, and risks.ts documents
 * it as "unverified provenance metadata ... not FK-verified against any source
 * table". Governance asks for the opposite shape — several findings (a pen-test
 * result, a vendor gap, a control deficiency) evidencing ONE register entry —
 * and asks for it to be a relationship it can report from, not a note.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   - No automatic promotion. A finding with no link is STANDALONE, that is the
 *     default, and nothing in this file creates a link without a person asking.
 *     Every write here is the direct result of an authenticated human action.
 *   - No second register and no second finding model. Promotion reuses
 *     validateRiskCreate, so a promoted risk is validated exactly like a
 *     hand-entered one and lands in the same table with the same constraints.
 *   - No scoring, no SLA, no policy parsing. Promotion asks the human for the
 *     likelihood and impact rather than inventing them, because a rating the
 *     register cannot attribute to a person is a rating nobody will defend.
 *
 * WHERE AI FITS LATER. `link_type` separates "attached to an existing risk"
 * from "promoted into a new one", and both are human acts. A future assistant
 * can recommend either — or recommend staying standalone — but a recommendation
 * must arrive as its own provisional object and still be accepted by a person
 * before a row appears here. Nothing in this file would need to change for that.
 *
 * TENANT ISOLATION, three layers, because a join table is the most attractive
 * place to leak — two ids from another tenant are enough to fabricate a
 * relationship unless every layer refuses:
 *   1. asTenant() opens the request transaction with app.current_org_id set;
 *   2. BOTH endpoints are re-verified against the caller's org before insert,
 *      so a cross-tenant id 404s instead of linking;
 *   3. the RLS policy on finding_risks carries USING *and* WITH CHECK.
 */

import { Router } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { validateRiskCreate } from "../lib/riskValidation.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTE = 2000;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function readNote(body: unknown): string | null {
  const raw = (body as Record<string, unknown> | null)?.["note"];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTE) : null;
}

function actor(req: unknown): { apiKeyId: string | null; userId: string | null } {
  const r = req as { apiKey?: { id?: string }; userId?: string };
  return { apiKeyId: r.apiKey?.id ?? null, userId: r.userId ?? null };
}

/**
 * Both endpoints of the relationship, re-verified inside the caller's org.
 *
 * Returning a single "not found" for either side is deliberate: distinguishing
 * "that risk does not exist" from "that risk belongs to someone else" would
 * turn this endpoint into an existence oracle for other tenants' ids.
 */
async function resolveEndpoints(
  organizationId: string,
  findingId: string,
  riskId: string | null
): Promise<{ ok: true } | { ok: false; missing: "finding" | "risk" }> {
  const finding = await pg.query(
    `SELECT 1 FROM findings WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [findingId, organizationId]
  );
  if (finding.rowCount === 0) return { ok: false, missing: "finding" };

  if (riskId !== null) {
    const risk = await pg.query(
      `SELECT 1 FROM risks WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [riskId, organizationId]
    );
    if (risk.rowCount === 0) return { ok: false, missing: "risk" };
  }

  return { ok: true };
}

const GUARDS = [
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  // Deciding that a finding belongs on the Risk Register is a governance act,
  // not queue work — the same posture risks.ts takes on risk creation.
  denyContributor(),
] as const;

/* =========================================================
   GET /api/findings/:id/risk-links
   The register entries this finding supports.
   ========================================================= */

router.get(
  "/findings/:id/risk-links",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId =
      ((req as never as { organizationContext?: { organizationId?: string } })
        .organizationContext?.organizationId) ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const findingId = String(req.params.id ?? "").trim();
    if (!isUuid(findingId)) {
      res.status(400).json({ error: "invalid_finding_id" });
      return;
    }

    try {
      const endpoints = await resolveEndpoints(organizationId, findingId, null);
      if (!endpoints.ok) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }

      const { rows } = await pg.query(
        `SELECT fr.risk_id,
                fr.link_type,
                fr.note,
                fr.created_at,
                fr.created_by_user_id,
                r.title        AS risk_title,
                r.domain       AS risk_domain,
                r.risk_rating  AS risk_rating,
                r.status       AS risk_status
           FROM finding_risks fr
           JOIN risks r
             ON r.id = fr.risk_id
            AND r.organization_id = fr.organization_id
          WHERE fr.organization_id = $1
            AND fr.finding_id = $2
          ORDER BY fr.created_at ASC`,
        [organizationId, findingId]
      );

      res.status(200).json({ links: rows, count: rows.length });
    } catch (err) {
      logger.error(
        { event: "finding_risk_links_list_failed", organizationId, findingId, err },
        "GET /findings/:id/risk-links failed"
      );
      res.status(500).json({ error: "finding_risk_links_failed" });
    }
  })
);

/* =========================================================
   GET /api/risks/:id/findings
   The findings that evidence this register entry.
   ========================================================= */

router.get(
  "/risks/:id/findings",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId =
      ((req as never as { organizationContext?: { organizationId?: string } })
        .organizationContext?.organizationId) ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const riskId = String(req.params.id ?? "").trim();
    if (!isUuid(riskId)) {
      res.status(400).json({ error: "invalid_risk_id" });
      return;
    }

    try {
      const risk = await pg.query(
        `SELECT 1 FROM risks WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [riskId, organizationId]
      );
      if (risk.rowCount === 0) {
        res.status(404).json({ error: "risk_not_found" });
        return;
      }

      const { rows } = await pg.query(
        `SELECT fr.finding_id,
                fr.link_type,
                fr.note,
                fr.created_at,
                f.title        AS finding_title,
                f.severity     AS finding_severity,
                f.status       AS finding_status,
                f.source_type  AS finding_source_type,
                f.due_date     AS finding_due_date
           FROM finding_risks fr
           JOIN findings f
             ON f.id = fr.finding_id
            AND f.organization_id = fr.organization_id
          WHERE fr.organization_id = $1
            AND fr.risk_id = $2
          ORDER BY fr.created_at ASC`,
        [organizationId, riskId]
      );

      res.status(200).json({ findings: rows, count: rows.length });
    } catch (err) {
      logger.error(
        { event: "risk_findings_list_failed", organizationId, riskId, err },
        "GET /risks/:id/findings failed"
      );
      res.status(500).json({ error: "risk_findings_failed" });
    }
  })
);

/* =========================================================
   POST /api/findings/:id/risk-links
   Attach this finding to a register entry that already exists.
   ========================================================= */

router.post(
  "/findings/:id/risk-links",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId =
      ((req as never as { organizationContext?: { organizationId?: string } })
        .organizationContext?.organizationId) ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const findingId = String(req.params.id ?? "").trim();
    const riskId = String((req.body as Record<string, unknown> | null)?.["risk_id"] ?? "").trim();

    if (!isUuid(findingId)) {
      res.status(400).json({ error: "invalid_finding_id" });
      return;
    }
    if (!isUuid(riskId)) {
      res.status(400).json({ error: "risk_id_required" });
      return;
    }

    try {
      const endpoints = await resolveEndpoints(organizationId, findingId, riskId);
      if (!endpoints.ok) {
        res.status(404).json({ error: `${endpoints.missing}_not_found` });
        return;
      }

      const note = readNote(req.body);
      const { userId, apiKeyId } = actor(req);

      // Idempotent: re-linking an already-linked pair returns the existing
      // relationship rather than a duplicate or an error. A register that
      // counted the same finding twice would overstate its own evidence, and a
      // 409 would make a double-click look like a failure.
      const inserted = await pg.query<{ id: string; created_at: string }>(
        `INSERT INTO finding_risks
           (organization_id, finding_id, risk_id, link_type, note, created_by_user_id)
         VALUES ($1, $2, $3, 'linked', $4, $5)
         ON CONFLICT (organization_id, finding_id, risk_id) DO NOTHING
         RETURNING id, created_at`,
        [organizationId, findingId, riskId, note, userId]
      );

      const created = (inserted.rowCount ?? 0) > 0;

      if (created) {
        writeAuditEvent({
          organizationId,
          actorApiKeyId: apiKeyId,
          actorUserId: userId,
          eventType: "finding.risk_linked",
          resourceType: "finding",
          resourceId: findingId,
          payload: { risk_id: riskId, link_type: "linked", has_note: note !== null },
        });
      }

      res.status(created ? 201 : 200).json({
        linked: true,
        already_linked: !created,
        finding_id: findingId,
        risk_id: riskId,
      });
    } catch (err) {
      logger.error(
        { event: "finding_risk_link_failed", organizationId, findingId, riskId, err },
        "POST /findings/:id/risk-links failed"
      );
      res.status(500).json({ error: "finding_risk_link_failed" });
    }
  })
);

/* =========================================================
   DELETE /api/findings/:id/risk-links/:riskId
   Detach, without touching either object.
   ========================================================= */

router.delete(
  "/findings/:id/risk-links/:riskId",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId =
      ((req as never as { organizationContext?: { organizationId?: string } })
        .organizationContext?.organizationId) ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const findingId = String(req.params.id ?? "").trim();
    const riskId = String(req.params.riskId ?? "").trim();

    if (!isUuid(findingId) || !isUuid(riskId)) {
      res.status(400).json({ error: "invalid_link_id" });
      return;
    }

    try {
      // The org predicate is on the DELETE itself, so a cross-tenant pair
      // removes nothing rather than 404-ing after a lookup that already
      // confirmed the row exists somewhere.
      const removed = await pg.query(
        `DELETE FROM finding_risks
          WHERE organization_id = $1 AND finding_id = $2 AND risk_id = $3
        RETURNING link_type`,
        [organizationId, findingId, riskId]
      );

      if ((removed.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "link_not_found" });
        return;
      }

      const { userId, apiKeyId } = actor(req);
      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyId,
        actorUserId: userId,
        eventType: "finding.risk_unlinked",
        resourceType: "finding",
        resourceId: findingId,
        // The link_type that WAS in force. Unlinking a promotion is a
        // materially different act from unlinking an attachment, and the audit
        // row is the only place that distinction survives the delete.
        payload: { risk_id: riskId, unlinked_link_type: removed.rows[0]?.link_type ?? null },
      });

      // Both objects survive by construction — this statement only ever
      // touches the relationship row.
      res.status(200).json({ unlinked: true, finding_id: findingId, risk_id: riskId });
    } catch (err) {
      logger.error(
        { event: "finding_risk_unlink_failed", organizationId, findingId, riskId, err },
        "DELETE /findings/:id/risk-links/:riskId failed"
      );
      res.status(500).json({ error: "finding_risk_unlink_failed" });
    }
  })
);

/* =========================================================
   POST /api/findings/:id/promote-to-risk
   Create a NEW register entry from this finding, and link them.
   ========================================================= */

router.post(
  "/findings/:id/promote-to-risk",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId =
      ((req as never as { organizationContext?: { organizationId?: string } })
        .organizationContext?.organizationId) ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const findingId = String(req.params.id ?? "").trim();
    if (!isUuid(findingId)) {
      res.status(400).json({ error: "invalid_finding_id" });
      return;
    }

    try {
      const finding = await pg.query<{ title: string; domain: string | null }>(
        `SELECT title, domain FROM findings
          WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [findingId, organizationId]
      );
      if (finding.rowCount === 0) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }
      const source = finding.rows[0]!;

      // Title and domain default from the finding so the common case is one
      // click; likelihood, impact and rating are NOT defaulted. A register
      // rating the organization cannot attribute to a person is a rating
      // nobody will defend in front of an auditor, so the human supplies it.
      const body = {
        title: source.title,
        domain: source.domain ?? undefined,
        ...(req.body as Record<string, unknown> | null ?? {}),
      };

      // The SAME validator risks.ts uses. A promoted risk is not a different
      // kind of risk, and must not be allowed to skip a rule a hand-entered
      // one obeys.
      const validated = validateRiskCreate(body);
      if ("error" in validated) {
        res.status(400).json(validated);
        return;
      }
      const input = validated.input;

      const { userId, apiKeyId } = actor(req);

      // source_type/source_id keep their existing meaning — "where this risk
      // was first identified". The RELATIONSHIP is the finding_risks row; this
      // is provenance, and both are written so neither reading is lost.
      const riskRow = await pg.query<{ id: string }>(
        `INSERT INTO risks
           (organization_id, title, description, domain, likelihood, impact,
            risk_rating, status, treatment, owner, due_date, source_type, source_id,
            inherent_likelihood, inherent_impact, inherent_rating,
            residual_likelihood, residual_impact, residual_rating)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'open'), $9, $10, $11, 'finding', $12,
                 $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [
          organizationId,
          input.title,
          input.description ?? null,
          input.domain,
          input.likelihood,
          input.impact,
          input.risk_rating,
          input.status ?? null,
          input.treatment ?? null,
          input.owner ?? null,
          input.due_date ?? null,
          findingId,
          // The inherent/residual trios are REQUIRED by validateRiskCreate, so
          // a promoted risk carries the same pre-controls and post-controls
          // assessment a hand-entered one does. Defaulting them would create a
          // register entry whose ratings nobody chose.
          input.inherent_likelihood,
          input.inherent_impact,
          input.inherent_rating,
          input.residual_likelihood,
          input.residual_impact,
          input.residual_rating,
        ]
      );
      const riskId = riskRow.rows[0]!.id;

      const note = readNote(req.body);
      await pg.query(
        `INSERT INTO finding_risks
           (organization_id, finding_id, risk_id, link_type, note, created_by_user_id)
         VALUES ($1, $2, $3, 'promoted', $4, $5)
         ON CONFLICT (organization_id, finding_id, risk_id) DO NOTHING`,
        [organizationId, findingId, riskId, note, userId]
      );

      // Two audit rows on purpose: the register needs "this risk was created",
      // and the finding needs "this is what happened to it". Reconstructing
      // either from the other is exactly the kind of inference an audit trail
      // exists to make unnecessary.
      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyId,
        actorUserId: userId,
        eventType: "risk.created",
        resourceType: "risk",
        resourceId: riskId,
        payload: { via: "finding_promotion", finding_id: findingId, domain: input.domain, risk_rating: input.risk_rating },
      });
      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyId,
        actorUserId: userId,
        eventType: "finding.promoted_to_risk",
        resourceType: "finding",
        resourceId: findingId,
        payload: { risk_id: riskId, risk_rating: input.risk_rating, has_note: note !== null },
      });

      logger.info(
        { event: "finding_promoted_to_risk", organizationId, findingId, riskId },
        "Finding promoted to a Risk Register entry"
      );

      res.status(201).json({
        promoted: true,
        finding_id: findingId,
        risk: { id: riskId, title: input.title, domain: input.domain, risk_rating: input.risk_rating },
      });
    } catch (err) {
      logger.error(
        { event: "finding_promote_to_risk_failed", organizationId, findingId, err },
        "POST /findings/:id/promote-to-risk failed"
      );
      res.status(500).json({ error: "finding_promote_to_risk_failed" });
    }
  })
);

export default router;
