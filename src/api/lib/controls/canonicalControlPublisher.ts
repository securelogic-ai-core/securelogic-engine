/**
 * canonicalControlPublisher.ts - the governed publication path for canonical
 * control reference content.
 *
 * -- Why this exists --------------------------------------------------------
 *
 * Migrations 20261067/68/69 create the tables and grant `app_request` SELECT
 * only. Reference content therefore cannot arrive through a request, and it is
 * deliberately NOT seeded by the migrations either: a migration cannot name the
 * human who published it, and `canonical_controls_publication_authority_check`
 * makes a published row without a named publisher impossible. Publication is a
 * governance act by a person, so it runs through an elevated script that takes
 * that person's user id.
 *
 * -- The three rules this module obeys -------------------------------------
 *
 * 1. It NEVER edits published content. `canonical_controls_publication_guard`
 *    freezes a published row, and correcting one is a NEW superseding row, not
 *    an UPDATE. Where the corpus disagrees with a published row this module
 *    REPORTS the divergence as drift and writes nothing. Silently reconciling
 *    it would destroy the reconstructability the freeze exists to protect.
 *
 * 2. It NEVER invents an identity. Every crosswalk slug must resolve to a
 *    corpus entry before ANY write happens; an unresolvable slug is a content
 *    bug and aborts the run rather than publishing a partial crosswalk.
 *
 * 3. A dry run executes the REAL statements and rolls back. It does not
 *    simulate them. A plan built from a different code path is a plan that can
 *    be right about a run that then fails on a constraint.
 *
 * 4. It FAILS CLOSED on ambiguity. If any published row diverges from the
 *    corpus, or any alias is bound to a different canonical control, an
 *    `apply` run ROLLS BACK and throws — it does not commit the additive part
 *    and report the problem afterwards. A published canonical key must never
 *    quietly come to mean something other than what the corpus says it means,
 *    and a run that commits alongside an unresolved conflict is exactly how
 *    that happens. A DRY RUN reports the same findings without throwing, so an
 *    operator can see the whole picture before deciding.
 */

import {
  CANONICAL_CONTROL_CORPUS,
  CANONICAL_CONTROL_CORPUS_VERSION,
} from "./canonicalControlCorpus.js";
import { canonicalControlKey, isLegalAliasKey } from "./canonicalControlIdentity.js";
import { CANONICAL_FRAMEWORK_VERSIONS } from "./canonicalFrameworkIdentity.js";
import {
  NIST_CSF_1_1_CROSSWALK,
  NIST_CSF_FRAMEWORK_KEY,
  NIST_CSF_FRAMEWORK_VERSION,
} from "./nistCsfCrosswalk.js";

type Row = Record<string, unknown>;
type QueryResult = { rows: Row[]; rowCount: number | null };

export type ClientLike = {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
  release: () => void;
};

export type PoolLike = { connect: () => Promise<ClientLike> };

/**
 * A published row whose content no longer matches the corpus. Reported, never
 * repaired: repairing it in place is exactly what the publication guard
 * forbids, and a superseding row is a separate, deliberate curation act.
 */
export type CanonicalControlDrift = {
  readonly canonical_key: string;
  readonly field: "display_name" | "description" | "control_family";
  readonly published: string | null;
  readonly corpus: string | null;
};

/**
 * A LIVE crosswalk row whose governed content no longer matches the module.
 *
 * `mapping_version` is deliberately NOT compared: it labels the curation pass
 * that created the row, and a later pass that leaves a mapping unchanged must
 * not relabel it — that would be an in-place edit of governed content, which
 * the publication guard forbids anyway. What IS compared is what a reviewer
 * approved: the rationale, the source, and the status.
 */
export type CrosswalkDrift = {
  readonly framework_key: string;
  readonly framework_version: string;
  readonly requirement_reference: string;
  readonly canonical_key: string;
  readonly field: "mapping_rationale" | "mapping_source" | "status";
  readonly published: string | null;
  readonly corpus: string | null;
};

/** An alias_key already bound to a DIFFERENT canonical control. */
export type AliasConflict = {
  readonly alias_key: string;
  readonly bound_to_key: string;
  readonly corpus_key: string;
};

export type PublicationResult = {
  readonly applied: boolean;
  readonly corpus_version: string;
  readonly published_by_user_id: string;
  readonly framework_versions_inserted: number;
  readonly controls_published: number;
  readonly controls_already_published: number;
  readonly aliases_inserted: number;
  readonly aliases_already_present: number;
  readonly crosswalk_published: number;
  readonly crosswalk_already_present: number;
  readonly drift: readonly CanonicalControlDrift[];
  readonly crosswalk_drift: readonly CrosswalkDrift[];
  readonly alias_conflicts: readonly AliasConflict[];
};

export class CanonicalPublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalPublicationError";
  }
}

/**
 * Content validation, run BEFORE a transaction opens. Everything here is
 * checkable without a database, and every failure is a defect in the corpus
 * modules rather than a state of the environment.
 */
export function validateCorpusContent(): void {
  const slugs = new Set<string>();
  const aliasKeys = new Map<string, string>();

  for (const c of CANONICAL_CONTROL_CORPUS) {
    // Throws on an illegal slug — the grammar is the CHECK, mirrored.
    canonicalControlKey(c.slug);
    if (slugs.has(c.slug)) {
      throw new CanonicalPublicationError(`duplicate canonical control slug: ${c.slug}`);
    }
    slugs.add(c.slug);

    for (const a of c.aliases) {
      if (!isLegalAliasKey(a.alias_key)) {
        throw new CanonicalPublicationError(
          `alias may not be spelled in the canonical namespace: ${a.alias_key}`
        );
      }
      const existing = aliasKeys.get(a.alias_key);
      if (existing !== undefined && existing !== c.slug) {
        // alias_key is GLOBALLY UNIQUE in the schema. Two corpus entries
        // claiming one alias is an ambiguous identity, not a merge candidate.
        throw new CanonicalPublicationError(
          `alias ${a.alias_key} is claimed by both ${existing} and ${c.slug}`
        );
      }
      aliasKeys.set(a.alias_key, c.slug);
    }
  }

  for (const entry of NIST_CSF_1_1_CROSSWALK) {
    for (const slug of entry.canonical_control_slugs) {
      if (!slugs.has(slug)) {
        throw new CanonicalPublicationError(
          `crosswalk ${entry.requirement_reference} references unknown canonical slug ${slug}`
        );
      }
    }
  }

  const known = CANONICAL_FRAMEWORK_VERSIONS.some(
    (f) =>
      f.framework_key === NIST_CSF_FRAMEWORK_KEY &&
      f.framework_version === NIST_CSF_FRAMEWORK_VERSION
  );
  if (!known) {
    throw new CanonicalPublicationError(
      `crosswalk framework ${NIST_CSF_FRAMEWORK_KEY} ${NIST_CSF_FRAMEWORK_VERSION} is not in the canonical framework registry`
    );
  }
}

/**
 * Publish the corpus, its aliases and the NIST CSF 1.1 crosswalk.
 *
 * `apply: false` (the default) runs every statement and ROLLBACKs, so the
 * reported counts are what a real run would do, proven against real
 * constraints.
 */
export async function publishCanonicalControls(
  pool: PoolLike,
  opts: { publishedByUserId: string; apply?: boolean }
): Promise<PublicationResult> {
  const apply = opts.apply ?? false;
  validateCorpusContent();

  const client = await pool.connect();
  const drift: CanonicalControlDrift[] = [];
  const crosswalkDrift: CrosswalkDrift[] = [];
  const aliasConflicts: AliasConflict[] = [];
  let frameworkVersionsInserted = 0;
  let controlsPublished = 0;
  let controlsAlreadyPublished = 0;
  let aliasesInserted = 0;
  let aliasesAlreadyPresent = 0;
  let crosswalkPublished = 0;
  let crosswalkAlreadyPresent = 0;

  try {
    await client.query("BEGIN");

    // 1. The publisher must be a real, named human. The FK would say so too,
    //    but a 23503 three hundred statements later is a worse answer than a
    //    sentence here.
    const publisher = await client.query(`SELECT id FROM users WHERE id = $1`, [
      opts.publishedByUserId,
    ]);
    if ((publisher.rowCount ?? 0) === 0) {
      throw new CanonicalPublicationError(
        `publisher ${opts.publishedByUserId} is not a user: publication must name a real human`
      );
    }

    // 2. The framework registry. Migration 20261068 seeds it; this keeps a key
    //    added to the module AFTER that migration shipped from failing the
    //    crosswalk FK. Additive only — a registry row is never edited here.
    for (const f of CANONICAL_FRAMEWORK_VERSIONS) {
      const r = await client.query(
        `INSERT INTO canonical_framework_versions
           (framework_key, framework_version, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (framework_key, framework_version) DO NOTHING`,
        [f.framework_key, f.framework_version, f.display_name]
      );
      frameworkVersionsInserted += r.rowCount ?? 0;
    }

    // 3. The controls themselves, published in one act by one named human.
    const idBySlug = new Map<string, string>();
    for (const c of CANONICAL_CONTROL_CORPUS) {
      const key = canonicalControlKey(c.slug);
      const inserted = await client.query(
        `INSERT INTO canonical_controls
           (canonical_key, display_name, description, control_family,
            status, published_by_user_id, published_at)
         VALUES ($1, $2, $3, $4, 'published', $5, NOW())
         ON CONFLICT (canonical_key) DO NOTHING
         RETURNING id`,
        [key, c.display_name, c.description, c.control_family, opts.publishedByUserId]
      );

      if ((inserted.rowCount ?? 0) > 0) {
        controlsPublished += 1;
        idBySlug.set(c.slug, String(inserted.rows[0]!.id));
        continue;
      }

      controlsAlreadyPublished += 1;
      const existing = await client.query(
        `SELECT id, display_name, description, control_family
           FROM canonical_controls WHERE canonical_key = $1`,
        [key]
      );
      const row = existing.rows[0]!;
      idBySlug.set(c.slug, String(row.id));

      // Drift is REPORTED, never repaired. See rule 1 in the header.
      const compare: ReadonlyArray<[CanonicalControlDrift["field"], string | null]> = [
        ["display_name", c.display_name],
        ["description", c.description],
        ["control_family", c.control_family],
      ];
      for (const [field, corpusValue] of compare) {
        const publishedValue = (row[field] ?? null) as string | null;
        if (publishedValue !== corpusValue) {
          drift.push({
            canonical_key: key,
            field,
            published: publishedValue,
            corpus: corpusValue,
          });
        }
      }
    }

    // 4. Aliases. alias_key is globally unique, so an alias already bound to a
    //    different control is an identity collision, not a duplicate.
    for (const c of CANONICAL_CONTROL_CORPUS) {
      const controlId = idBySlug.get(c.slug)!;
      for (const a of c.aliases) {
        const r = await client.query(
          `INSERT INTO canonical_control_aliases
             (canonical_control_id, alias_key, alias_scheme, source)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (alias_key) DO NOTHING`,
          [controlId, a.alias_key, a.alias_scheme, `corpus:${CANONICAL_CONTROL_CORPUS_VERSION}`]
        );
        if ((r.rowCount ?? 0) > 0) {
          aliasesInserted += 1;
          continue;
        }
        aliasesAlreadyPresent += 1;
        const bound = await client.query(
          `SELECT cc.canonical_key
             FROM canonical_control_aliases a
             JOIN canonical_controls cc ON cc.id = a.canonical_control_id
            WHERE a.alias_key = $1`,
          [a.alias_key]
        );
        const boundKey = String(bound.rows[0]?.canonical_key ?? "");
        const corpusKey = canonicalControlKey(c.slug);
        if (boundKey !== corpusKey) {
          aliasConflicts.push({
            alias_key: a.alias_key,
            bound_to_key: boundKey,
            corpus_key: corpusKey,
          });
        }
      }
    }

    // 5. The crosswalk. Published in the same act, by the same named human —
    //    `mapping_source = 'securelogic'` and a curator actor kind, because
    //    this content is curated, not model-proposed. ON CONFLICT names the
    //    partial index predicate so it infers the LIVE-row unique index.
    for (const entry of NIST_CSF_1_1_CROSSWALK) {
      for (const slug of entry.canonical_control_slugs) {
        const r = await client.query(
          `INSERT INTO canonical_control_crosswalk
             (framework_key, framework_version, requirement_reference,
              canonical_control_id, mapping_source, mapping_rationale,
              mapping_version, status, proposed_by_actor_kind,
              proposed_by_actor_ref, approved_by_user_id, approved_at)
           VALUES ($1, $2, $3, $4, 'securelogic', $5, $6, 'published',
                   'securelogic_curator', $7, $8, NOW())
           ON CONFLICT (framework_key, framework_version, requirement_reference,
                        canonical_control_id)
             WHERE superseded_at IS NULL
           DO NOTHING`,
          [
            NIST_CSF_FRAMEWORK_KEY,
            NIST_CSF_FRAMEWORK_VERSION,
            entry.requirement_reference,
            idBySlug.get(slug)!,
            entry.rationale,
            CANONICAL_CONTROL_CORPUS_VERSION,
            `corpus:${CANONICAL_CONTROL_CORPUS_VERSION}`,
            opts.publishedByUserId,
          ]
        );
        if ((r.rowCount ?? 0) > 0) {
          crosswalkPublished += 1;
          continue;
        }

        // The row is already live. ON CONFLICT DO NOTHING means a CHANGED
        // rationale would otherwise be a silent no-op: the module would claim
        // one justification while the database held another, and the mapping
        // a human approved would no longer be the mapping the corpus
        // describes. Read it back and say so.
        crosswalkAlreadyPresent += 1;
        const live = await client.query(
          `SELECT mapping_rationale, mapping_source, status
             FROM canonical_control_crosswalk
            WHERE framework_key = $1 AND framework_version = $2
              AND requirement_reference = $3 AND canonical_control_id = $4
              AND superseded_at IS NULL`,
          [
            NIST_CSF_FRAMEWORK_KEY,
            NIST_CSF_FRAMEWORK_VERSION,
            entry.requirement_reference,
            idBySlug.get(slug)!,
          ]
        );
        const liveRow = live.rows[0];
        if (liveRow !== undefined) {
          const expected: ReadonlyArray<[CrosswalkDrift["field"], string | null]> = [
            ["mapping_rationale", entry.rationale],
            ["mapping_source", "securelogic"],
            ["status", "published"],
          ];
          for (const [field, corpusValue] of expected) {
            const publishedValue = (liveRow[field] ?? null) as string | null;
            if (publishedValue !== corpusValue) {
              crosswalkDrift.push({
                framework_key: NIST_CSF_FRAMEWORK_KEY,
                framework_version: NIST_CSF_FRAMEWORK_VERSION,
                requirement_reference: entry.requirement_reference,
                canonical_key: canonicalControlKey(slug),
                field,
                published: publishedValue,
                corpus: corpusValue,
              });
            }
          }
        }
      }
    }

    // FAIL CLOSED. Ambiguity is not something to commit alongside: an alias
    // bound to two identities, or published content that no longer matches the
    // corpus, means the operator does not yet know what the published key
    // means. Resolve it with a superseding row and run again. A dry run still
    // reports everything it found — that is how the operator sees it.
    const ambiguities =
      drift.length + crosswalkDrift.length + aliasConflicts.length;
    if (apply && ambiguities > 0) {
      await client.query("ROLLBACK");
      throw new CanonicalPublicationError(
        `refusing to publish: ${drift.length} drifted canonical control field(s), ` +
          `${crosswalkDrift.length} drifted crosswalk field(s) and ` +
          `${aliasConflicts.length} alias identity conflict(s). Published content is ` +
          `frozen and was NOT modified — resolve each with a superseding row, then ` +
          `re-run. Nothing was committed.`
      );
    }

    await client.query(apply ? "COMMIT" : "ROLLBACK");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the original error is the one worth raising */
    }
    throw err;
  } finally {
    client.release();
  }

  return {
    applied: apply,
    corpus_version: CANONICAL_CONTROL_CORPUS_VERSION,
    published_by_user_id: opts.publishedByUserId,
    framework_versions_inserted: frameworkVersionsInserted,
    controls_published: controlsPublished,
    controls_already_published: controlsAlreadyPublished,
    aliases_inserted: aliasesInserted,
    aliases_already_present: aliasesAlreadyPresent,
    crosswalk_published: crosswalkPublished,
    crosswalk_already_present: crosswalkAlreadyPresent,
    drift,
    crosswalk_drift: crosswalkDrift,
    alias_conflicts: aliasConflicts,
  };
}
