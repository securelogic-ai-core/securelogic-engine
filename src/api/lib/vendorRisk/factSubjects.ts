/**
 * factSubjects.ts — the CLOSED allowlist of subjects a fact may be recorded
 * against, and the ONLY way a route or a mirror obtains a subject
 * (VA-Q2 P3; owner decision D1 = Option B, 2026-08-28).
 *
 * `assessment_facts.subject_id` is polymorphic and carries no FK. Integrity is
 * therefore three layers, each tested on its own:
 *
 *   1. RLS on `assessment_facts` by `organization_id` (migration 20261063);
 *   2. the BEFORE INSERT/UPDATE trigger `assessment_facts_check_subject()`
 *      that loads the subject `WHERE id AND organization_id` per type;
 *   3. THIS module — `SUBJECT_RESOLVERS[subject_type]` runs INSIDE the
 *      caller's `asTenant`/`withTenant` scope, loads the subject row and
 *      compares `organization_id` to the caller's org (belt-and-braces over
 *      RLS). A fact write API that accepts a raw `subject_id` does not exist.
 *
 * A missing subject and a subject owned by another org return the SAME
 * answer (`null`) so a route maps both to its existing 404 — no existence
 * oracle. RESERVED types (`vendor`, `ai_system`, `asset`, `organization`) are
 * refused here too: each enters only with the migration that widens the DB
 * CHECK, its own resolver arm and its adversarial tests.
 *
 * The constants block is pure so `factRegistry.ts` (a pure module under the
 * ADR-0013 R2 import lint) can import the allowlist from here.
 */

import type { Pool, PoolClient } from "pg";

import type { EngagementState } from "./engagementStateMachine.js";

// ── Constants (pure) ────────────────────────────────────────────────────────

/** Subject types a fact may be recorded against TODAY. Lockstep with the DB CHECK (tested from pg_constraint). */
export const FACT_SUBJECT_TYPES = ["vendor_engagement"] as const;
export type FactSubjectType = (typeof FACT_SUBJECT_TYPES)[number];

/** Reserved for later packages. Refused by every writer AND reader in Q2. */
export const RESERVED_FACT_SUBJECT_TYPES = ["vendor", "ai_system", "asset", "organization"] as const;

/** The subject reference carried on a fact row. */
export type FactSubjectRef = { subject_type: FactSubjectType; subject_id: string };

export function isFactSubjectType(value: unknown): value is FactSubjectType {
  return typeof value === "string" && (FACT_SUBJECT_TYPES as readonly string[]).includes(value);
}

export function isReservedFactSubjectType(value: unknown): boolean {
  return typeof value === "string" && (RESERVED_FACT_SUBJECT_TYPES as readonly string[]).includes(value);
}

// ── Resolved subjects ───────────────────────────────────────────────────────

export type Queryable = Pick<Pool | PoolClient, "query">;

/** A subject loaded inside the tenant scope. `organization_id` is the caller's — asserted, not assumed. */
export type VendorEngagementSubject = {
  kind: "vendor_engagement";
  id: string;
  organization_id: string;
  vendor_id: string;
  state: EngagementState;
  scope_rule_version: string;
  /** The engagement's `updated_at` — the intake mirror's `observed_at`. */
  updated_at: Date;
};

export type ResolvedFactSubject = VendorEngagementSubject;

export type SubjectResolver = (q: Queryable, organizationId: string, subjectId: string) => Promise<ResolvedFactSubject | null>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveVendorEngagement(q: Queryable, organizationId: string, subjectId: string): Promise<ResolvedFactSubject | null> {
  if (!UUID_RE.test(subjectId) || !UUID_RE.test(organizationId)) return null;
  const r = await q.query<{
    id: string;
    organization_id: string;
    vendor_id: string;
    status: string;
    scope_rule_version: string | null;
    updated_at: Date;
  }>(
    `SELECT id, organization_id, vendor_id, status, scope_rule_version, updated_at
       FROM vendor_engagements
      WHERE id = $1 AND organization_id = $2
      LIMIT 1`,
    [subjectId, organizationId]
  );
  const row = r.rows[0];
  if (!row) return null;
  // Belt-and-braces over RLS and over the WHERE clause: a row that is not the
  // caller's is not a subject, whatever path loaded it.
  if (row.organization_id !== organizationId) return null;
  return {
    kind: "vendor_engagement",
    id: row.id,
    organization_id: row.organization_id,
    vendor_id: row.vendor_id,
    state: row.status as EngagementState,
    scope_rule_version: typeof row.scope_rule_version === "string" ? row.scope_rule_version : "1.0.0",
    updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

/**
 * One resolver per ACTIVE subject type. Adding a type = adding an entry here
 * in the same PR as the migration that widens the CHECK and the tests that
 * prove the new arm — the `Record` type makes forgetting one a compile error.
 */
export const SUBJECT_RESOLVERS: Readonly<Record<FactSubjectType, SubjectResolver>> = {
  vendor_engagement: resolveVendorEngagement,
};

/**
 * Resolve a subject for a caller. `subjectType` is `unknown` on purpose: a
 * reserved or invented type is refused BEFORE any query, and refused the same
 * way a missing subject is (null → the route's 404).
 */
export async function resolveFactSubject(
  q: Queryable,
  organizationId: string,
  subjectType: unknown,
  subjectId: unknown
): Promise<ResolvedFactSubject | null> {
  if (!isFactSubjectType(subjectType)) return null;
  if (typeof subjectId !== "string") return null;
  return SUBJECT_RESOLVERS[subjectType](q, organizationId, subjectId);
}

/** The `(subject_type, subject_id)` reference of a resolved subject, for fact rows. */
export function subjectRef(subject: ResolvedFactSubject): FactSubjectRef {
  return { subject_type: subject.kind, subject_id: subject.id };
}
