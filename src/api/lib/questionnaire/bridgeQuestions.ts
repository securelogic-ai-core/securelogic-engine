/**
 * bridgeQuestions.ts — VA-Q1 P2/P3: the requirement-as-question bridge and the
 * content-addressed identity of an issued questionnaire.
 *
 * ── Why a bridge ─────────────────────────────────────────────────────────────
 * ADR-0013 R1 says a vendor sees questions, never requirement text. Until the
 * curated library covers a requirement, the question we ask IS the requirement
 * — its title as the prompt, its description as the guidance, asked as an
 * attestation. This module materialises exactly that as a real, immutable,
 * linked `question_versions` row, so day-one questionnaires are byte-for-byte
 * what they were before P2 while every item is already addressed by version.
 *
 * ── Why lazily, at composition ───────────────────────────────────────────────
 * Requirements enter the library through three separate insert paths
 * (requirements.ts, frameworkActivation.ts, templateLoader.ts). Hooking each
 * leaves a fourth un-hooked one day. Ensuring the bridge at the moment a
 * requirement is put in scope cannot miss, and it is idempotent: the same
 * requirement text always yields the same content hash, so a second ensure is
 * a no-op and an EDITED requirement yields version N+1 with N left standing.
 *
 * ── The one rule about editing ───────────────────────────────────────────────
 * A requirement edit BEFORE issue is reflected (the next composition bridges
 * the new text). A requirement edit AFTER issue changes nothing the vendor or
 * the reviewer sees, because the scope item points at the version row that was
 * current when scope froze. That is the whole of R3, and it is what the P2
 * golden test asserts.
 *
 * Runs on the caller's tenant connection (asTenant / withTenant); every
 * statement carries organization_id.
 */

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  bridgeContentForRequirement,
  bridgeQuestionKey,
  domainForScopeTags,
  questionContentHash,
} from "./questionContent.js";

type Queryable = Pick<Pool | PoolClient, "query">;

export type BridgeableRequirement = {
  requirement_id: string;
  framework_id: string;
  reference_id: string;
  title: string;
  description: string | null;
  scope_tags?: string[];
};

/**
 * Ensure every requirement has a bridge question whose CURRENT version carries
 * the requirement's present text. Returns requirement_id → question_version_id.
 *
 * Curated questions (keys outside the `req:` namespace) are never touched
 * here; they are addressed by their own versions through links (P3+).
 */
export async function ensureBridgeQuestions(
  db: Queryable,
  organizationId: string,
  requirements: BridgeableRequirement[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  for (const req of requirements) {
    const key = bridgeQuestionKey(req.framework_id, req.reference_id);
    const content = bridgeContentForRequirement({ title: req.title, description: req.description });
    const hash = questionContentHash(content);
    const domain = domainForScopeTags(req.scope_tags ?? []);

    // 1. The identity. Idempotent by (org, key).
    await db.query(
      `INSERT INTO questions (organization_id, question_key, domain, origin, template_key, status)
       VALUES ($1, $2, $3, 'securelogic', 'bridge', 'draft')
       ON CONFLICT (organization_id, question_key) DO NOTHING`,
      [organizationId, key, domain]
    );
    const q = await db.query<{ id: string; current_version: number }>(
      `SELECT id, current_version FROM questions
        WHERE organization_id = $1 AND question_key = $2 FOR UPDATE`,
      [organizationId, key]
    );
    const questionId = q.rows[0]!.id;

    // 2. The lineage. A bridge question evidences exactly its requirement.
    await db.query(
      `INSERT INTO question_requirement_links (organization_id, question_id, requirement_id, relation)
       VALUES ($1, $2, $3, 'evidences')
       ON CONFLICT (question_id, requirement_id) DO NOTHING`,
      [organizationId, questionId, req.requirement_id]
    );

    // 3. The content. Same hash → same row; new hash → version N+1.
    const existing = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM question_versions
        WHERE organization_id = $1 AND question_id = $2 AND content_hash = $3`,
      [organizationId, questionId, hash]
    );
    let versionId: string;
    if (existing.rowCount && existing.rows[0]) {
      versionId = existing.rows[0].id;
    } else {
      const next = q.rows[0]!.current_version + 1;
      const ins = await db.query<{ id: string }>(
        `INSERT INTO question_versions
           (organization_id, question_id, version, prompt, guidance, answer_type, options,
            evidence_policy, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
         RETURNING id`,
        [organizationId, questionId, next, content.prompt, content.guidance, content.answer_type,
         content.evidence_policy, hash]
      );
      versionId = ins.rows[0]!.id;
      await db.query(
        `UPDATE questions SET current_version = $3, status = 'active', updated_at = NOW()
          WHERE id = $1 AND organization_id = $2`,
        [questionId, organizationId, next]
      );
    }
    // A bridge question is active from its first version: it is linked by
    // construction and its content is the requirement's own.
    await db.query(
      `UPDATE questions SET status = 'active', updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = 'draft'`,
      [questionId, organizationId]
    );

    out.set(req.requirement_id, versionId);
  }

  return out;
}

export type QuestionSetItem = {
  content_hash: string;
  depth: string;
  mandatory: boolean;
  /** Stable tiebreak so equal content in a different requirement order still hashes identically per engagement. */
  requirement_id: string;
};

/**
 * The content-addressed identity of a questionnaire: sha256 over the items in
 * a canonical order. Order is by (mandatory desc, content_hash, requirement_id)
 * — NOT by reference_id — so the hash depends only on what is asked and how,
 * never on a requirement's display label.
 */
export function questionSetHash(items: QuestionSetItem[]): string {
  const ordered = [...items].sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    if (a.content_hash !== b.content_hash) return a.content_hash < b.content_hash ? -1 : 1;
    return a.requirement_id < b.requirement_id ? -1 : a.requirement_id > b.requirement_id ? 1 : 0;
  });
  const canonical = JSON.stringify(
    ordered.map((i) => [i.content_hash, i.depth, i.mandatory ? 1 : 0])
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Read an engagement's askable items in the shape the hash needs. Items with
 * no version (pre-P2 rows) are reported so the caller can say "unstamped"
 * rather than hashing a partial set.
 */
export async function loadQuestionSetItems(
  db: Queryable,
  organizationId: string,
  engagementId: string
): Promise<{ items: QuestionSetItem[]; unversioned: number }> {
  const rows = await db.query<{
    requirement_id: string;
    depth: string;
    mandatory: boolean;
    content_hash: string | null;
  }>(
    `SELECT si.requirement_id, si.depth, si.mandatory, qv.content_hash
       FROM vendor_engagement_scope_items si
       LEFT JOIN question_versions qv
         ON qv.id = si.question_version_id AND qv.organization_id = si.organization_id
      WHERE si.engagement_id = $1 AND si.organization_id = $2
        AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)`,
    [engagementId, organizationId]
  );
  const items: QuestionSetItem[] = [];
  let unversioned = 0;
  for (const r of rows.rows) {
    if (!r.content_hash) { unversioned += 1; continue; }
    items.push({ content_hash: r.content_hash, depth: r.depth, mandatory: r.mandatory, requirement_id: r.requirement_id });
  }
  return { items, unversioned };
}
