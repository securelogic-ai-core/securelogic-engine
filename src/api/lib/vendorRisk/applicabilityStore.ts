/**
 * applicabilityStore.ts — persist WHAT APPLIED and WHY (#926, slot 20261065).
 *
 * The one writer for `engagement_applicability`. There is no route that writes
 * it: applicability is a determination the resolver makes, not something a
 * caller asserts.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A rule's activation used to be recorded only on the ITEMS it contributed, so
 * when composition truncated every one of those items the stored scope contained
 * no evidence the rule ever fired. Six tier-4 engagements on staging activated
 * privacy, AI and nth-party and recorded none of them.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * The unique key includes `basis_hash`, so re-resolving with unchanged inputs
 * inserts nothing and a resolve whose basis CHANGED appends without touching
 * history. `ON CONFLICT DO NOTHING` is therefore the whole idempotency story —
 * no read-compare-write, and no race between two concurrent resolves.
 *
 * ── What it does NOT write ──────────────────────────────────────────────────
 * Whether a question represented the requirement, whether composition truncated
 * it, whether assurance covers it, and whether it is still a gap. All four are
 * current state that legitimately changes after the resolve; freezing them here
 * would be wrong within hours. They are derived — see `applicabilityGaps`.
 */

import { createHash } from "node:crypto";

import type { ApplicabilityRecord } from "./scopeResolver.js";

/** Minimal query surface, so this works on a pool or a transaction client. */
export type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

/** Stable stringify so an identical basis always hashes identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function basisHash(basis: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(basis), "utf8").digest("hex");
}

/**
 * Record every applicability determination from one resolve.
 *
 * Returns how many rows were newly written — 0 on a repeat, which is what
 * callers assert idempotency against.
 */
export async function recordApplicability(
  db: Queryable,
  args: {
    organizationId: string;
    engagementId: string;
    scopeRuleVersion: string;
    records: readonly ApplicabilityRecord[];
  }
): Promise<{ inserted: number }> {
  if (args.records.length === 0) return { inserted: 0 };

  const values: unknown[] = [];
  const rows: string[] = [];
  for (const r of args.records) {
    const base = values.length;
    values.push(
      args.organizationId,
      args.engagementId,
      r.rule_id,
      r.rule_family,
      r.domain,
      r.requirement_id,
      r.requirement_reference_id,
      JSON.stringify(r.basis),
      basisHash(r.basis),
      args.scopeRuleVersion
    );
    rows.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, $${base + 8}::jsonb, $${base + 9}, $${base + 10})`
    );
  }

  const res = await db.query(
    `INSERT INTO engagement_applicability
       (organization_id, engagement_id, rule_id, rule_family, domain,
        requirement_id, requirement_reference_id, basis, basis_hash, scope_rule_version)
     VALUES ${rows.join(", ")}
     ON CONFLICT DO NOTHING`,
    values
  );
  return { inserted: res.rowCount ?? 0 };
}

export type ApplicabilityGap = {
  rule_id: string;
  rule_family: string;
  domain: string | null;
  requirement_id: string;
  requirement_reference_id: string;
  basis: Record<string, unknown>;
  resolved_at: string;
  /** False when composition dropped every question for this requirement. */
  represented_by_question: boolean;
};

/**
 * What applied, joined against what is CURRENTLY asked.
 *
 * This is the query #926 exists to enable, and the shape of it is the point:
 * `represented_by_question` is DERIVED by a left join against the live scope
 * items, never stored. Assurance coverage would join here too once S4 is wired
 * (`docs/design/VA-S4-assurance-wiring-plan.md`); until then a gap degrades
 * honestly to "applicable but not asked".
 *
 * An applicable requirement with no question and no assurance is precisely the
 * invisible assurance gap the owner ruled must never exist.
 */
export async function loadApplicability(
  db: Queryable,
  organizationId: string,
  engagementId: string
): Promise<ApplicabilityGap[]> {
  const res = await db.query<{
    rule_id: string;
    rule_family: string;
    domain: string | null;
    requirement_id: string;
    requirement_reference_id: string;
    basis: Record<string, unknown>;
    resolved_at: string;
    represented_by_question: boolean;
  }>(
    `SELECT a.rule_id, a.rule_family, a.domain, a.requirement_id,
            a.requirement_reference_id, a.basis, a.resolved_at,
            (s.requirement_id IS NOT NULL) AS represented_by_question
       FROM engagement_applicability a
       LEFT JOIN vendor_engagement_scope_items s
              ON s.engagement_id = a.engagement_id
             AND s.requirement_id = a.requirement_id
      WHERE a.organization_id = $1 AND a.engagement_id = $2
      ORDER BY a.resolved_at DESC, a.rule_id, a.requirement_reference_id`,
    [organizationId, engagementId]
  );
  return res.rows;
}
