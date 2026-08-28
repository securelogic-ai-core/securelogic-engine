/**
 * va-q1-bridge-equivalence.ts — VA-Q1 P3 acceptance: prove, on a real
 * database, that addressing the questionnaire by version changed NOTHING a
 * vendor or reviewer sees, and that every stamped hash still recomputes.
 *
 * For every engagement on the target database it renders the askable items
 * two ways and compares them field by field, in order:
 *   requirement path   (reference, title, description)   — what P1-and-before rendered
 *   version path       (reference, COALESCE(version, requirement) text) — what P2 renders
 * They must be byte-equal for every engagement whose items point at a version
 * that bridges the requirement's CURRENT text. Where the requirement has been
 * edited after issue the version path is DELIBERATELY different — that is R3
 * working — and the engagement is reported as `pinned_diverged`, not failed.
 *
 * Then, for every issued engagement with a stamp, recomputes the hash in
 * TypeScript from the stored items and compares (the P2 integrity check, over
 * the whole database at once).
 *
 * READ-ONLY. Refuses production. Exit 1 on any unexplained divergence.
 *
 *   tsx scripts/validation/va-q1-bridge-equivalence.ts
 */

import { pgElevated } from "../../src/api/infra/postgres.js";
import { questionSetHash } from "../../src/api/lib/questionnaire/bridgeQuestions.js";

type Row = { reference_id: string; title: string; description: string | null };

async function main(): Promise<void> {
  const db = await pgElevated.query<{ current_database: string }>("SELECT current_database()");
  if (db.rows[0]!.current_database === "securelogic") {
    console.error("refusing to run against production");
    process.exit(2);
  }

  const engagements = await pgElevated.query<{ id: string; organization_id: string; status: string; issued_at: string | null; question_set_hash: string | null }>(
    `SELECT id, organization_id, status, issued_at, question_set_hash FROM vendor_engagements ORDER BY created_at`
  );

  let equal = 0, pinnedDiverged = 0, failed = 0, hashMatch = 0, hashDrift = 0, unstamped = 0;

  for (const e of engagements.rows) {
    const reqPath = await pgElevated.query<Row>(
      `SELECT r.reference_id, r.title, r.description
         FROM vendor_engagement_scope_items si JOIN requirements r ON r.id = si.requirement_id
        WHERE si.engagement_id = $1 AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
        ORDER BY r.reference_id ASC`,
      [e.id]
    );
    const verPath = await pgElevated.query<Row & { pinned: boolean }>(
      `SELECT r.reference_id,
              COALESCE(qv.prompt, r.title) AS title,
              COALESCE(qv.guidance, r.description) AS description,
              (qv.id IS NOT NULL AND (qv.prompt <> r.title OR COALESCE(qv.guidance,'') <> COALESCE(NULLIF(trim(r.description),''),''))) AS pinned
         FROM vendor_engagement_scope_items si
         JOIN requirements r ON r.id = si.requirement_id
         LEFT JOIN question_versions qv ON qv.id = si.question_version_id
        WHERE si.engagement_id = $1 AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
        ORDER BY r.reference_id ASC`,
      [e.id]
    );

    const norm = (r: Row) => [r.reference_id, r.title.trim(), (r.description ?? "").trim() || null];
    const a = JSON.stringify(reqPath.rows.map(norm));
    const b = JSON.stringify(verPath.rows.map(norm));
    if (a === b) equal += 1;
    else if (verPath.rows.some((r) => r.pinned)) pinnedDiverged += 1;
    else { failed += 1; console.error(`DIVERGED without a pinned edit: engagement ${e.id} (${e.status})`); }

    if (e.issued_at) {
      const items = await pgElevated.query<{ content_hash: string | null; depth: string; mandatory: boolean; requirement_id: string }>(
        `SELECT qv.content_hash, si.depth, si.mandatory, si.requirement_id
           FROM vendor_engagement_scope_items si LEFT JOIN question_versions qv ON qv.id = si.question_version_id
          WHERE si.engagement_id = $1 AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)`,
        [e.id]
      );
      if (!e.question_set_hash || items.rows.some((i) => !i.content_hash)) unstamped += 1;
      else if (questionSetHash(items.rows as never) === e.question_set_hash) hashMatch += 1;
      else { hashDrift += 1; console.error(`HASH DRIFT: engagement ${e.id}`); }
    }
  }

  console.log(JSON.stringify({
    engagements: engagements.rows.length,
    render_equal: equal,
    render_pinned_diverged_by_design: pinnedDiverged,
    render_failed: failed,
    hash_match: hashMatch,
    hash_drift: hashDrift,
    issued_unstamped_historical: unstamped,
  }, null, 2));
  await pgElevated.end();
  process.exit(failed > 0 || hashDrift > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
