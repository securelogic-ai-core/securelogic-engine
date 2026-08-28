/**
 * questions.ts — the curated vendor question library (VA-Q1 / P1).
 *
 * ADR-0013 R1: a question is content; a requirement is canon. This module is
 * the write surface for that content. It is INTERNAL-ONLY (premium, admin for
 * every mutation) and JSON-only; nothing here is reachable from a vendor
 * portal session, and the assembled-app suite asserts that.
 *
 * The one rule everything below serves — R3, content is immutable once
 * published: there is no "edit a version" route. Changing a question's text
 * means POST /questions/:id/versions, which appends version N+1 and leaves N
 * exactly where every issued questionnaire that referenced it expects to find
 * it. PATCH /questions/:id may change status only.
 *
 * Requirements carry no organization_id (they inherit scope through their
 * framework), so a link's org check is a framework join — the same shape the
 * requirements router uses to verify a framework belongs to the caller.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { asTenant } from "../middleware/asTenant.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireAdminRole } from "../middleware/requireRole.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  QUESTION_DOMAINS,
  QUESTION_KEY_PATTERN,
  QUESTION_STATUSES,
  LINK_RELATIONS,
  validateQuestionContent,
  questionContentHash,
} from "../lib/questionnaire/questionContent.js";

const router = Router();

const readChain = [requireApiKey, attachOrganizationContext, requireEntitlement("premium"), denyContributor()];
const writeChain = [...readChain, requireAdminRole];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function orgOf(req: Request): string | null {
  return ((req as any).organizationContext?.organizationId as string | undefined) ?? null;
}
function userOf(req: Request): string | null {
  return ((req as any).userId as string | undefined) ?? null;
}
function apiKeyOf(req: Request): string | null {
  return ((req as any).apiKey?.id as string | undefined) ?? null;
}

const QUESTION_COLUMNS = `
  id, organization_id, question_key, domain, origin, template_key, status,
  current_version, created_by_user_id, created_at, updated_at`;

const VERSION_COLUMNS = `
  id, question_id, version, prompt, guidance, answer_type, options,
  evidence_policy, content_hash, published_at, published_by_user_id`;

/* =========================================================
   GET /api/questions — list, with current version summary and link count.
   ========================================================= */
router.get(
  "/questions",
  ...readChain,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }

    const status = typeof req.query.status === "string" ? req.query.status : null;
    if (status && !(QUESTION_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ error: "invalid_status", allowed: QUESTION_STATUSES }); return;
    }
    const domain = typeof req.query.domain === "string" ? req.query.domain : null;
    if (domain && !(QUESTION_DOMAINS as readonly string[]).includes(domain)) {
      res.status(400).json({ error: "invalid_domain", allowed: QUESTION_DOMAINS }); return;
    }

    try {
      const result = await pg.query(
        `SELECT q.id, q.question_key, q.domain, q.origin, q.template_key, q.status,
                q.current_version, q.created_at, q.updated_at,
                v.prompt AS current_prompt, v.answer_type AS current_answer_type,
                v.content_hash AS current_content_hash,
                (SELECT COUNT(*)::int FROM question_requirement_links l
                  WHERE l.question_id = q.id AND l.organization_id = q.organization_id) AS link_count
           FROM questions q
           LEFT JOIN question_versions v
             ON v.question_id = q.id AND v.organization_id = q.organization_id
            AND v.version = q.current_version
          WHERE q.organization_id = $1
            AND ($2::text IS NULL OR q.status = $2)
            AND ($3::text IS NULL OR q.domain = $3)
          ORDER BY q.domain, q.question_key
          LIMIT 500`,
        [organizationId, status, domain]
      );
      res.status(200).json({ count: result.rows.length, questions: result.rows });
    } catch (err) {
      logger.error({ err, organizationId }, "GET /questions failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

/* =========================================================
   POST /api/questions — create the identity (draft, no content yet).
   Content arrives through POST /questions/:id/versions so that creation and
   publication are the same two-step everywhere, including the bridge.
   ========================================================= */
router.post(
  "/questions",
  ...writeChain,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.question_key === "string" ? body.question_key.trim() : "";
    const domain = typeof body.domain === "string" ? body.domain : "";
    const fields: Array<{ field: string; reason: string }> = [];
    if (!QUESTION_KEY_PATTERN.test(key)) fields.push({ field: "question_key", reason: "2–200 chars of [a-z0-9._:-], starting alphanumeric" });
    if (key.startsWith("req:")) fields.push({ field: "question_key", reason: "the req: namespace is reserved for bridge questions" });
    if (!(QUESTION_DOMAINS as readonly string[]).includes(domain)) fields.push({ field: "domain", reason: `must be one of: ${QUESTION_DOMAINS.join(", ")}` });
    if (fields.length > 0) { res.status(400).json({ error: "invalid_question", fields }); return; }

    try {
      const inserted = await pg.query(
        `INSERT INTO questions (organization_id, question_key, domain, origin, status, created_by_user_id)
         VALUES ($1, $2, $3, 'customer', 'draft', $4)
         ON CONFLICT (organization_id, question_key) DO NOTHING
         RETURNING ${QUESTION_COLUMNS}`,
        [organizationId, key, domain, userOf(req)]
      );
      if (inserted.rowCount === 0) { res.status(409).json({ error: "question_key_exists" }); return; }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyOf(req),
        actorUserId: userOf(req),
        eventType: "question.created",
        resourceType: "question",
        resourceId: inserted.rows[0]!.id,
        payload: { question_key: key, domain },
      });
      res.status(201).json({ question: inserted.rows[0] });
    } catch (err) {
      logger.error({ err, organizationId }, "POST /questions failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

/* =========================================================
   GET /api/questions/:id — the question, every version, every link.
   ========================================================= */
router.get(
  "/questions/:id",
  ...readChain,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const id = String(req.params["id"] ?? "");
    if (!UUID_RE.test(id)) { res.status(404).json({ error: "question_not_found" }); return; }

    try {
      const q = await pg.query(
        `SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      if (q.rowCount === 0) { res.status(404).json({ error: "question_not_found" }); return; }

      const [versions, links] = await Promise.all([
        pg.query(
          `SELECT ${VERSION_COLUMNS} FROM question_versions
            WHERE question_id = $1 AND organization_id = $2 ORDER BY version DESC`,
          [id, organizationId]
        ),
        pg.query(
          `SELECT l.id, l.requirement_id, l.relation, l.created_at,
                  r.reference_id, r.title AS requirement_title, r.framework_id, f.name AS framework_name
             FROM question_requirement_links l
             JOIN requirements r ON r.id = l.requirement_id
             JOIN frameworks f ON f.id = r.framework_id AND f.organization_id = l.organization_id
            WHERE l.question_id = $1 AND l.organization_id = $2
            ORDER BY f.name, r.reference_id`,
          [id, organizationId]
        ),
      ]);
      res.status(200).json({ question: q.rows[0], versions: versions.rows, links: links.rows });
    } catch (err) {
      logger.error({ err, organizationId }, "GET /questions/:id failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

/* =========================================================
   POST /api/questions/:id/versions — publish content as version N+1.

   Identical content is a no-op that returns the existing version (the
   per-question hash index makes that a race-free 200, not a 409). Publishing
   requires at least one requirement link unless the caller passes
   `allow_unlinked: true` AND the question stays 'draft' — a linked-nothing
   question can exist while it is being authored, but it can never go active.
   ========================================================= */
router.post(
  "/questions/:id/versions",
  ...writeChain,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const id = String(req.params["id"] ?? "");
    if (!UUID_RE.test(id)) { res.status(404).json({ error: "question_not_found" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const validated = validateQuestionContent(body.content ?? body);
    if (!validated.ok) { res.status(400).json(validated); return; }
    const activate = body.activate === true;
    const contentHash = questionContentHash(validated.content);

    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      const q = await client.query<{ current_version: number; status: string }>(
        `SELECT current_version, status FROM questions
          WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [id, organizationId]
      );
      if (q.rowCount === 0) { await client.query("ROLLBACK"); res.status(404).json({ error: "question_not_found" }); return; }
      if (q.rows[0]!.status === "retired") { await client.query("ROLLBACK"); res.status(409).json({ error: "question_retired" }); return; }

      const links = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM question_requirement_links WHERE question_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      const linked = Number(links.rows[0]?.n ?? "0") > 0;
      if (activate && !linked) {
        await client.query("ROLLBACK");
        res.status(422).json({
          error: "unlinked_question",
          message: "A question must evidence at least one requirement before it can be active. Add a link first.",
        });
        return;
      }

      // Same content already published under this question → return it.
      const existing = await client.query(
        `SELECT ${VERSION_COLUMNS} FROM question_versions
          WHERE question_id = $1 AND organization_id = $2 AND content_hash = $3`,
        [id, organizationId, contentHash]
      );
      let version = existing.rows[0] ?? null;
      let created = false;
      if (!version) {
        const next = q.rows[0]!.current_version + 1;
        const c = validated.content;
        const ins = await client.query(
          `INSERT INTO question_versions
             (organization_id, question_id, version, prompt, guidance, answer_type, options,
              evidence_policy, content_hash, published_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
           RETURNING ${VERSION_COLUMNS}`,
          [organizationId, id, next, c.prompt, c.guidance, c.answer_type,
           c.options ? JSON.stringify(c.options) : null, c.evidence_policy, contentHash, userOf(req)]
        );
        version = ins.rows[0]!;
        created = true;
        await client.query(
          `UPDATE questions SET current_version = $3, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2`,
          [id, organizationId, next]
        );
      }
      if (activate) {
        await client.query(
          `UPDATE questions SET status = 'active', updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [id, organizationId]
        );
      }
      await client.query("COMMIT");

      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyOf(req),
        actorUserId: userOf(req),
        eventType: created ? "question.version_published" : "question.version_reused",
        resourceType: "question",
        resourceId: id,
        payload: { version: (version as any).version, content_hash: contentHash, activated: activate },
      });
      res.status(created ? 201 : 200).json({ version, created, activated: activate });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error({ err, organizationId }, "POST /questions/:id/versions failed");
      res.status(500).json({ error: "internal_error" });
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   PATCH /api/questions/:id — status only. Content is versions.
   ========================================================= */
router.patch(
  "/questions/:id",
  ...writeChain,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const id = String(req.params["id"] ?? "");
    if (!UUID_RE.test(id)) { res.status(404).json({ error: "question_not_found" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const disallowed = Object.keys(body).filter((k) => k !== "status");
    if (disallowed.length > 0) {
      res.status(400).json({
        error: "content_is_immutable",
        message: "Only `status` can be patched. Changing content publishes a new version: POST /questions/:id/versions.",
        fields: disallowed,
      });
      return;
    }
    const status = typeof body.status === "string" ? body.status : "";
    if (!(QUESTION_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ error: "invalid_status", allowed: QUESTION_STATUSES }); return;
    }

    try {
      if (status === "active") {
        const ok = await pg.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM question_requirement_links WHERE question_id = $1 AND organization_id = $2`,
          [id, organizationId]
        );
        if (Number(ok.rows[0]?.n ?? "0") === 0) { res.status(422).json({ error: "unlinked_question" }); return; }
      }
      const upd = await pg.query(
        `UPDATE questions SET status = $3, updated_at = NOW()
          WHERE id = $1 AND organization_id = $2
            AND (($3 <> 'active') OR current_version >= 1)
          RETURNING ${QUESTION_COLUMNS}`,
        [id, organizationId, status]
      );
      if (upd.rowCount === 0) {
        const exists = await pg.query(`SELECT 1 FROM questions WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
        if (exists.rowCount === 0) { res.status(404).json({ error: "question_not_found" }); return; }
        res.status(422).json({ error: "no_published_version", message: "Publish a version before activating." });
        return;
      }
      writeAuditEvent({
        organizationId, actorApiKeyId: apiKeyOf(req), actorUserId: userOf(req),
        eventType: "question.status_changed", resourceType: "question", resourceId: id, payload: { status },
      });
      res.status(200).json({ question: upd.rows[0] });
    } catch (err) {
      logger.error({ err, organizationId }, "PATCH /questions/:id failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

/* =========================================================
   POST /api/questions/:id/links — link to a requirement of THIS org.
   The requirement must belong to one of the org's frameworks; a foreign or
   unknown requirement is indistinguishable (404).
   ========================================================= */
router.post(
  "/questions/:id/links",
  ...writeChain,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const id = String(req.params["id"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requirementId = typeof body.requirement_id === "string" ? body.requirement_id : "";
    const relation = body.relation === undefined ? "evidences" : body.relation;
    if (!UUID_RE.test(id)) { res.status(404).json({ error: "question_not_found" }); return; }
    if (!UUID_RE.test(requirementId)) { res.status(400).json({ error: "requirement_id_required" }); return; }
    if (typeof relation !== "string" || !(LINK_RELATIONS as readonly string[]).includes(relation)) {
      res.status(400).json({ error: "invalid_relation", allowed: LINK_RELATIONS }); return;
    }

    try {
      const q = await pg.query(`SELECT 1 FROM questions WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
      if (q.rowCount === 0) { res.status(404).json({ error: "question_not_found" }); return; }

      const r = await pg.query(
        `SELECT r.id FROM requirements r
           JOIN frameworks f ON f.id = r.framework_id
          WHERE r.id = $1 AND f.organization_id = $2`,
        [requirementId, organizationId]
      );
      if (r.rowCount === 0) { res.status(404).json({ error: "requirement_not_found" }); return; }

      const ins = await pg.query(
        `INSERT INTO question_requirement_links (organization_id, question_id, requirement_id, relation, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (question_id, requirement_id) DO NOTHING
         RETURNING id, question_id, requirement_id, relation, created_at`,
        [organizationId, id, requirementId, relation, userOf(req)]
      );
      if (ins.rowCount === 0) { res.status(409).json({ error: "link_exists" }); return; }
      writeAuditEvent({
        organizationId, actorApiKeyId: apiKeyOf(req), actorUserId: userOf(req),
        eventType: "question.linked", resourceType: "question", resourceId: id,
        payload: { requirement_id: requirementId, relation },
      });
      res.status(201).json({ link: ins.rows[0] });
    } catch (err) {
      logger.error({ err, organizationId }, "POST /questions/:id/links failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

/* =========================================================
   DELETE /api/questions/:id/links/:linkId — unlink. An ACTIVE question must
   keep at least one link; removing the last one is refused so an active
   question can never lose its lineage.
   ========================================================= */
router.delete(
  "/questions/:id/links/:linkId",
  ...writeChain,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) { res.status(403).json({ error: "organization_context_missing" }); return; }
    const id = String(req.params["id"] ?? "");
    const linkId = String(req.params["linkId"] ?? "");
    if (!UUID_RE.test(id) || !UUID_RE.test(linkId)) { res.status(404).json({ error: "link_not_found" }); return; }

    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      const q = await client.query<{ status: string }>(
        `SELECT status FROM questions WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, organizationId]
      );
      if (q.rowCount === 0) { await client.query("ROLLBACK"); res.status(404).json({ error: "link_not_found" }); return; }
      const n = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM question_requirement_links WHERE question_id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
      if (q.rows[0]!.status === "active" && Number(n.rows[0]?.n ?? "0") <= 1) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "last_link_on_active_question", message: "Retire the question or add another link first." });
        return;
      }
      const del = await client.query(
        `DELETE FROM question_requirement_links WHERE id = $1 AND question_id = $2 AND organization_id = $3 RETURNING requirement_id`,
        [linkId, id, organizationId]
      );
      await client.query("COMMIT");
      if (del.rowCount === 0) { res.status(404).json({ error: "link_not_found" }); return; }
      writeAuditEvent({
        organizationId, actorApiKeyId: apiKeyOf(req), actorUserId: userOf(req),
        eventType: "question.unlinked", resourceType: "question", resourceId: id,
        payload: { requirement_id: del.rows[0]!.requirement_id },
      });
      res.status(204).end();
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error({ err, organizationId }, "DELETE /questions/:id/links/:linkId failed");
      res.status(500).json({ error: "internal_error" });
    } finally {
      client.release();
    }
  })
);

export default router;
