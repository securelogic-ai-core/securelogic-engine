/**
 * contributorProjection.ts — bounded projections for Contributor reads.
 *
 * A Contributor may read an object assigned to or owned by them. The DANGER is
 * lateral reference expansion: an owned finding links to a vendor, a control, an
 * assessment; returning those in full would let one owned parent unfold into a
 * tenant-wide read. A projection is the contract that prevents it:
 *
 *   allow      — the exact top-level fields a Contributor receives, verbatim.
 *   stubLinks  — nested related objects reduced to a { id, label } stub; the
 *                Contributor learns the linked thing EXISTS and its display name,
 *                never its contents.
 *
 * Anything not in `allow` and not a declared stub link is DROPPED. This is a
 * whitelist by construction: a field added to a serializer later is invisible to
 * Contributors until someone deliberately adds it here. Default deny, in data.
 *
 * The registry is populated per family as each is scoped (Phase 3). An object
 * type with no registered projection returns null from projectForContributor —
 * the caller MUST treat "no projection" as "not Contributor-visible" (deny), not
 * as "return everything".
 */

export interface ProjectionSpec {
  /** Top-level fields returned verbatim. */
  allow: readonly string[];
  /**
   * Nested link fields reduced to { id, label }. Key is the field on the row
   * whose value is an object (or already an {id,label}); idField/labelField name
   * where to read the id and human label from that object.
   */
  stubLinks?: Readonly<
    Record<string, { idField: string; labelField: string }>
  >;
}

export type ProjectedRow = Record<string, unknown>;

/**
 * Reduce a related object to a bounded { id, label } stub, or null when the
 * link is absent. Accepts either a nested object or a scalar id.
 */
function stub(
  value: unknown,
  idField: string,
  labelField: string
): { id: unknown; label: unknown } | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return { id: o[idField] ?? null, label: o[labelField] ?? null };
  }
  // A scalar id with no embedded label.
  return { id: value, label: null };
}

/**
 * Project a single row for a Contributor per the object type's spec. Returns a
 * NEW object containing only whitelisted fields and stubbed links. Returns null
 * when the object type has no registered projection (caller denies).
 */
export function projectForContributor(
  objectType: string,
  row: Record<string, unknown>
): ProjectedRow | null {
  const spec = CONTRIBUTOR_PROJECTIONS[objectType];
  if (!spec) return null;

  const out: ProjectedRow = {};
  for (const field of spec.allow) {
    if (field in row) out[field] = row[field];
  }
  if (spec.stubLinks) {
    for (const [field, { idField, labelField }] of Object.entries(spec.stubLinks)) {
      if (field in row) out[field] = stub(row[field], idField, labelField);
    }
  }
  return out;
}

/** Project a list of rows; rows the type cannot project are dropped entirely. */
export function projectListForContributor(
  objectType: string,
  rows: Array<Record<string, unknown>>
): ProjectedRow[] {
  const spec = CONTRIBUTOR_PROJECTIONS[objectType];
  if (!spec) return [];
  return rows.map((r) => projectForContributor(objectType, r)!).filter(Boolean);
}

export function hasContributorProjection(objectType: string): boolean {
  return objectType in CONTRIBUTOR_PROJECTIONS;
}

/**
 * The registry. Field lists are intentionally conservative and are tightened to
 * the real serializer shapes as each family is scoped in Phase 3. A link that a
 * Contributor should see the NAME of goes in stubLinks; everything else is
 * simply omitted from `allow`.
 */
export const CONTRIBUTOR_PROJECTIONS: Readonly<Record<string, ProjectionSpec>> = {
  finding: {
    allow: [
      "id",
      "title",
      "description",
      "severity",
      "status",
      "domain",
      "source_type",
      "due_date",
      "owner_user_id",
      "created_at",
      "updated_at",
    ],
    stubLinks: {
      vendor: { idField: "id", labelField: "name" },
      control: { idField: "id", labelField: "name" },
    },
  },
  action: {
    allow: [
      "id",
      "title",
      "description",
      "status",
      "due_date",
      "owner_user_id",
      "parent_finding_id",
      "created_at",
      "updated_at",
    ],
  },
  evidence: {
    allow: [
      "id",
      "title",
      "description",
      "file_name",
      "content_type",
      "uploaded_by_user_id",
      "created_at",
    ],
  },
};
