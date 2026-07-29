/**
 * resourceHistory — shared per-object audit-trail reader.
 *
 * Generalizes the RR-3 pattern shipped on GET /api/risks/:id/history:
 * security_audit_log rows scoped to one root object plus its satellite
 * resources (assessments, reviews, links), newest first, paginated,
 * mirroring the GET /api/audit-log field shape so the frontend reuses
 * the existing event renderer.
 *
 * Tenancy rules (mirrors risks.ts):
 *   - every branch of the WHERE is scoped to organization_id = $1;
 *   - satellite subqueries filter BOTH the parent FK and organization_id,
 *     so a stale resource_id from another org can never bleed in;
 *   - satellite subqueries do NOT filter deleted_at — a .deleted event
 *     must stay visible after the satellite row is soft-deleted;
 *   - callers must verify root-object ownership FIRST and 404 on miss
 *     (an empty list for a foreign id would leak existence by absence).
 *
 * Query execution is strictly sequential (events, then count): under the
 * asTenant wrap both queries share the single per-request tenant client,
 * which cannot run concurrent queries (A04-G1 γ.1).
 *
 * risks.ts still carries its original inline copy of this pattern — its
 * SQL is pinned by risksHistoryRoute.test.ts. Porting it here is a
 * recorded follow-up (csvExport-style two-step migration).
 */

// Type-only: does not execute postgres.ts at load.
import type { pg as PgClient } from "../infra/postgres.js";

type PostgresModule = { pg: typeof PgClient };

// postgres.ts throws at load when DATABASE_URL is unset, which would make
// this module un-importable in database-free unit suites. The infra import
// is deferred to first fetch and the module promise cached (repeated
// synchronous dynamic imports of a vi.mocked module silently fail for all
// but the first call — cache the promise once).
let pgModule: Promise<PostgresModule> | null = null;
function loadPg(): Promise<PostgresModule> {
  if (!pgModule) pgModule = import("../infra/postgres.js");
  return pgModule;
}

export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 100;

export function parseHistoryLimit(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), HISTORY_MAX_LIMIT);
}

export function parseHistoryOffset(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHistoryUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type SatelliteSpec = {
  /** security_audit_log.resource_type written for the satellite rows. */
  resourceType: string;
  /** Table holding the satellite rows (id UUID PK, organization_id). */
  table: string;
  /** FK column on `table` pointing at the root object. */
  fkColumn: string;
};

export type ResourceHistorySpec = {
  /** security_audit_log.resource_type of the root object. */
  rootType: string;
  satellites: SatelliteSpec[];
};

/**
 * Table/column names below are compile-time constants from the specs in
 * this module — never caller input. Root id and org id are parameterized.
 */
export function buildResourceHistoryWhere(spec: ResourceHistorySpec): string {
  const branches = [
    `(sal.resource_type = '${spec.rootType}' AND sal.resource_id = $2::uuid)`,
    ...spec.satellites.map(
      (s) => `(sal.resource_type = '${s.resourceType}' AND sal.resource_id IN (
              SELECT id FROM ${s.table}
              WHERE ${s.fkColumn} = $2::uuid AND organization_id = $1
            ))`
    ),
  ];
  return `sal.organization_id = $1
          AND (
            ${branches.join("\n            OR\n            ")}
          )`;
}

export type ResourceHistoryEvent = {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ResourceHistoryPage = {
  events: ResourceHistoryEvent[];
  total_count: number;
  limit: number;
  offset: number;
};

export async function fetchResourceHistory(
  spec: ResourceHistorySpec,
  organizationId: string,
  resourceId: string,
  limit: number,
  offset: number
): Promise<ResourceHistoryPage> {
  const { pg } = await loadPg();
  const where = buildResourceHistoryWhere(spec);

  // ORDER BY (created_at DESC, id DESC) matches GET /api/audit-log for
  // stable pagination. Events first, count second — never concurrent.
  const eventsResult = await pg.query(
    `
    SELECT
      sal.id,
      sal.event_type,
      sal.actor_user_id,
      u.email        AS actor_email,
      u.name         AS actor_name,
      sal.resource_type,
      sal.resource_id,
      sal.ip_address,
      sal.payload    AS metadata,
      sal.created_at
    FROM security_audit_log sal
    LEFT JOIN users u ON u.id = sal.actor_user_id
    WHERE ${where}
    ORDER BY sal.created_at DESC, sal.id DESC
    LIMIT $3 OFFSET $4
    `,
    [organizationId, resourceId, limit, offset]
  );

  const countResult = await pg.query<{ total: string }>(
    `
    SELECT COUNT(*)::text AS total
    FROM security_audit_log sal
    WHERE ${where}
    `,
    [organizationId, resourceId]
  );

  return {
    events: eventsResult.rows as ResourceHistoryEvent[],
    total_count: parseInt(countResult.rows[0]?.total ?? "0", 10),
    limit,
    offset,
  };
}

/* =========================================================
   Register specs. resource_type strings verified against the
   writeAuditEvent calls in the corresponding route files;
   table/FK columns verified against db/migrations.
   ========================================================= */

export const VENDOR_HISTORY_SPEC: ResourceHistorySpec = {
  rootType: "vendor",
  satellites: [
    { resourceType: "vendor_assessment", table: "vendor_assessments", fkColumn: "vendor_id" },
    { resourceType: "vendor_review", table: "vendor_reviews", fkColumn: "vendor_id" },
    { resourceType: "vendor_assurance_document", table: "vendor_assurance_documents", fkColumn: "vendor_id" },
  ],
};

export const CONTROL_HISTORY_SPEC: ResourceHistorySpec = {
  rootType: "control",
  satellites: [
    { resourceType: "control_assessment", table: "control_assessments", fkColumn: "control_id" },
    { resourceType: "risk_control_link", table: "risk_control_links", fkColumn: "control_id" },
  ],
};

export const OBLIGATION_HISTORY_SPEC: ResourceHistorySpec = {
  rootType: "obligation",
  satellites: [
    { resourceType: "obligation_assessment", table: "obligation_assessments", fkColumn: "obligation_id" },
    { resourceType: "risk_obligation_link", table: "risk_obligation_links", fkColumn: "obligation_id" },
  ],
};

export const AI_SYSTEM_HISTORY_SPEC: ResourceHistorySpec = {
  rootType: "ai_system",
  satellites: [
    { resourceType: "governance_review", table: "governance_reviews", fkColumn: "ai_system_id" },
  ],
};
