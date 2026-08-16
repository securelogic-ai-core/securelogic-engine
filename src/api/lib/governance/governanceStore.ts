/**
 * governanceStore.ts — the only Postgres reader/writer for TDG state.
 *
 * Every statement here names `organization_id` explicitly IN ADDITION to
 * running inside withTenant() (TDG-13). The tenant scope is the guarantee; the
 * predicate is the proof that survives a scope that was forgotten, mis-wired or
 * not yet enforcing — which is exactly today's situation, since RLS is inert
 * until the app_request flip (KNOWN_ISSUES M-1).
 *
 * All functions assume they are already inside `withTenant(organizationId, …)`.
 */

import { pg } from "../../infra/postgres.js";
import type { RetentionPolicyVersion } from "./retentionPolicy.js";
import type { ActiveHold } from "./holdPredicate.js";

/* ────────────────────────────── retention_policies ───────────────────────── */

interface PolicyRow {
  id: string;
  organization_id: string;
  data_class: string;
  version: number;
  retention_days: number | null;
  cleared: boolean;
  source: "tenant" | "contract";
  effective_from: Date;
}

function toPolicyVersion(r: PolicyRow): RetentionPolicyVersion {
  return {
    id: r.id,
    organizationId: r.organization_id,
    dataClass: r.data_class,
    version: r.version,
    retentionDays: r.retention_days,
    cleared: r.cleared,
    source: r.source,
    effectiveFrom: r.effective_from
  };
}

/** All versions for one class, newest first. The resolver filters again. */
export async function listPolicyVersions(
  organizationId: string,
  dataClass: string
): Promise<RetentionPolicyVersion[]> {
  const { rows } = await pg.query<PolicyRow>(
    `SELECT id, organization_id, data_class, version, retention_days,
            cleared, source, effective_from
       FROM retention_policies
      WHERE organization_id = $1 AND data_class = $2
      ORDER BY version DESC`,
    [organizationId, dataClass]
  );
  return rows.map(toPolicyVersion);
}

/** Every version the org holds, for the settings surface. */
export async function listAllPolicyVersions(
  organizationId: string
): Promise<RetentionPolicyVersion[]> {
  const { rows } = await pg.query<PolicyRow>(
    `SELECT id, organization_id, data_class, version, retention_days,
            cleared, source, effective_from
       FROM retention_policies
      WHERE organization_id = $1
      ORDER BY data_class ASC, version DESC`,
    [organizationId]
  );
  return rows.map(toPolicyVersion);
}

export interface InsertPolicyInput {
  organizationId: string;
  dataClass: string;
  /** Null only when `cleared` — reverting to the platform default. */
  retentionDays: number | null;
  cleared: boolean;
  source: "tenant" | "contract";
  setByUserId: string | null;
  reason: string | null;
}

/**
 * Append a new policy version. The version number is allocated in the INSERT
 * itself, so two concurrent writers either serialise or collide on the UNIQUE
 * constraint — never interleave into a silently lost update. The table is
 * append-only at the database level, so this is the ONLY way policy state moves.
 */
export async function insertPolicyVersion(
  input: InsertPolicyInput
): Promise<RetentionPolicyVersion> {
  const { rows } = await pg.query<PolicyRow>(
    `INSERT INTO retention_policies
       (organization_id, data_class, version, retention_days, cleared, source, set_by_user_id, reason)
     SELECT $1, $2,
            COALESCE(MAX(version), 0) + 1,
            $3, $4, $5, $6, $7
       FROM retention_policies
      WHERE organization_id = $1 AND data_class = $2
     RETURNING id, organization_id, data_class, version, retention_days,
               cleared, source, effective_from`,
    [
      input.organizationId,
      input.dataClass,
      input.retentionDays,
      input.cleared,
      input.source,
      input.setByUserId,
      input.reason
    ]
  );
  const row = rows[0];
  if (!row) throw new Error("retention policy insert returned no row");
  return toPolicyVersion(row);
}

/* ────────────────────────────────── legal_holds ──────────────────────────── */

interface HoldRow {
  id: string;
  organization_id: string;
  scope_type: ActiveHold["scopeType"];
  data_class: string | null;
  subject_user_id: string | null;
  object_id: string | null;
  reason: string;
  status: "active" | "released";
  placed_by_user_id: string | null;
  placed_at: Date;
  released_by_user_id: string | null;
  released_at: Date | null;
  release_reason: string | null;
}

export interface LegalHoldRecord extends ActiveHold {
  organizationId: string;
  reason: string;
  status: "active" | "released";
  placedByUserId: string | null;
  placedAt: Date;
  releasedByUserId: string | null;
  releasedAt: Date | null;
  releaseReason: string | null;
}

function toHold(r: HoldRow): LegalHoldRecord {
  return {
    id: r.id,
    organizationId: r.organization_id,
    scopeType: r.scope_type,
    dataClass: r.data_class,
    subjectUserId: r.subject_user_id,
    objectId: r.object_id,
    reason: r.reason,
    status: r.status,
    placedByUserId: r.placed_by_user_id,
    placedAt: r.placed_at,
    releasedByUserId: r.released_by_user_id,
    releasedAt: r.released_at,
    releaseReason: r.release_reason
  };
}

const HOLD_COLUMNS = `id, organization_id, scope_type, data_class, subject_user_id,
                      object_id, reason, status, placed_by_user_id, placed_at,
                      released_by_user_id, released_at, release_reason`;

/**
 * Active holds for one organization. Read ONCE per sweep run and per delete
 * request, then evaluated in memory by holdPredicate — so every object in a run
 * is judged against exactly the same hold set, and a hold placed mid-run cannot
 * make a batch partially held.
 */
export async function listActiveHolds(organizationId: string): Promise<LegalHoldRecord[]> {
  const { rows } = await pg.query<HoldRow>(
    `SELECT ${HOLD_COLUMNS} FROM legal_holds
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY placed_at ASC`,
    [organizationId]
  );
  return rows.map(toHold);
}

export async function listHolds(organizationId: string): Promise<LegalHoldRecord[]> {
  const { rows } = await pg.query<HoldRow>(
    `SELECT ${HOLD_COLUMNS} FROM legal_holds
      WHERE organization_id = $1
      ORDER BY placed_at DESC`,
    [organizationId]
  );
  return rows.map(toHold);
}

export async function findHold(
  organizationId: string,
  holdId: string
): Promise<LegalHoldRecord | null> {
  const { rows } = await pg.query<HoldRow>(
    `SELECT ${HOLD_COLUMNS} FROM legal_holds
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, holdId]
  );
  return rows[0] ? toHold(rows[0]) : null;
}

export interface InsertHoldInput {
  organizationId: string;
  scopeType: ActiveHold["scopeType"];
  dataClass: string | null;
  subjectUserId: string | null;
  objectId: string | null;
  reason: string;
  placedByUserId: string;
}

export async function insertHold(input: InsertHoldInput): Promise<LegalHoldRecord> {
  const { rows } = await pg.query<HoldRow>(
    `INSERT INTO legal_holds
       (organization_id, scope_type, data_class, subject_user_id, object_id, reason, placed_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${HOLD_COLUMNS}`,
    [
      input.organizationId,
      input.scopeType,
      input.dataClass,
      input.subjectUserId,
      input.objectId,
      input.reason,
      input.placedByUserId
    ]
  );
  const row = rows[0];
  if (!row) throw new Error("legal hold insert returned no row");
  return toHold(row);
}

/**
 * The one permitted UPDATE. Guarded on `status = 'active'` so a double-release
 * affects 0 rows and the caller reports a conflict rather than overwriting the
 * first release's actor and timestamp.
 */
export async function releaseHold(input: {
  organizationId: string;
  holdId: string;
  releasedByUserId: string;
  releaseReason: string;
}): Promise<LegalHoldRecord | null> {
  const { rows } = await pg.query<HoldRow>(
    `UPDATE legal_holds
        SET status = 'released',
            released_by_user_id = $3,
            released_at = NOW(),
            release_reason = $4
      WHERE organization_id = $1 AND id = $2 AND status = 'active'
     RETURNING ${HOLD_COLUMNS}`,
    [input.organizationId, input.holdId, input.releasedByUserId, input.releaseReason]
  );
  return rows[0] ? toHold(rows[0]) : null;
}
