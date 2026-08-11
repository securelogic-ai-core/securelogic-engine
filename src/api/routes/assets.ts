/**
 * assets.ts — Enterprise Asset Registry, Phase 0 read surface.
 *
 *   GET /api/assets
 *
 * The unified cross-type asset list over `asset_registry_v` (20260802 view —
 * vendors ∪ ai_systems ∪ enterprise_entities projected to the canonical
 * header, ARCHITECTURE.md §2.1/§3.2). Read-only; per-type routes/pages remain
 * authoritative for type-specific detail (EAR-AD-1 federation).
 *
 * Route chain mirrors every ECL route: registry flag FIRST (404 while dark) →
 * auth → org context → capability → asTenant. Gated by its OWN flag
 * (SECURELOGIC_ASSET_REGISTRY_ENABLED, default off) so the registry can be
 * staged independently of the ECL surface, and by the SAME per-org capability
 * ("enterprise_context") — the registry federates the same platform inventory
 * the ECL owns, so a separate capability would be a second gating vocabulary
 * for one commercial boundary.
 *
 * Every query filters `WHERE organization_id = $1` inside the asTenant
 * transaction — explicit org discipline is the primary tenant control for the
 * view (vendors/ai_systems carry no RLS today; see the 20260802 migration
 * header for the security_invoker defense-in-depth).
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { sqlAssetAtRisk, sqlCurrentDecisionsCte } from "../lib/riskDimensionData.js";
import { asTenant } from "../middleware/asTenant.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { signalApplicabilityFeatureFlag } from "../lib/signalApplicabilityFeatureFlag.js";
import { IDENTITY_CONFIDENCE } from "../lib/tenantAssetResolver.js";
import {
  validateAttestationCreate,
  HUMAN_PROVENANCE
} from "../lib/assetProductIdentityValidation.js";
import { isAssetType } from "../lib/assetRegistry.js";
import { normalizeAssetSearchTerm, resolveAssetSearch } from "../lib/assetSearchResolver.js";
import {
  validateAssetDetailCreate,
  validateAssetDetailUpdate,
  DETAIL_TABLE_SPEC,
  isDetailBackedType,
  DETAIL_BACKED_TYPES,
  type DetailBackedType
} from "../lib/assetDetailValidation.js";
import {
  createDetailAsset,
  updateDetailAsset,
  deleteDetailAsset
} from "../lib/assetDetailPersistence.js";
import { parseImportFile } from "../lib/enterpriseImportParser.js";
import { planAssetImport } from "../lib/assetImportPlan.js";
import { assetImportExistingKeys, assetImportCapHeadroom } from "../lib/assetImportPersistence.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { getConnector } from "../lib/connectors/registry.js";
import { summarizeDiscovery, type ObservationFact } from "../lib/discoveryConfidence.js";
import { riskIntelligenceFeatureFlag } from "../lib/riskIntelligenceFeatureFlag.js";
import { resolveNeighborhood, DEFAULT_DEPTH, MAX_DEPTH } from "../lib/enterpriseGraphResolver.js";
import { ownRiskForNodes } from "../lib/assetOwnRisk.js";
import { propagateRisk, type RiskNode } from "../lib/graphRiskPropagation.js";

const router = Router();

/** Map an asset's backing table to its graph node identity (EAR-AD-4). */
function graphNodeForBacking(backingKind: string, backingId: string, assetId: string): { node_type: string; node_id: string } {
  switch (backingKind) {
    case "vendors":
      return { node_type: "vendor", node_id: backingId };
    case "ai_systems":
      return { node_type: "ai_system", node_id: backingId };
    case "enterprise_entities":
      return { node_type: "enterprise_entity", node_id: backingId };
    default:
      // The four detail tables are Tier-0 'asset' graph nodes keyed by registry id.
      return { node_type: "asset", node_id: assetId };
  }
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MAX_OFFSET = 100_000;
const INTEGER_RE = /^-?\d+$/;

const ASSET_COLS = `
  asset_id, asset_type, organization_id, name, criticality, owner_user_id,
  status, backing_kind, backing_id, lifecycle_status, created_at, updated_at
`;

/**
 * The same columns, qualified. The list joins the current-decision ledger when
 * `at_risk=true`, and `asset_id` exists on both sides — unqualified, it is ambiguous
 * and Postgres rejects the query. Same columns, same order; only the prefix differs.
 */
const ASSET_COLS_V = ASSET_COLS.split(",")
  .map((c) => `v.${c.trim()}`)
  .join(", ");

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

function parseBoundedInt(raw: unknown, fallback: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !INTEGER_RE.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
  return n;
}


export async function listAssets(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parseBoundedInt(req.query.offset, DEFAULT_OFFSET, MAX_OFFSET);
  if (limit === null || offset === null) {
    res.status(400).json({ error: "invalid_pagination" });
    return;
  }

  const rawType = req.query.asset_type;
  let typeFilter: string | null = null;
  if (rawType !== undefined) {
    if (!isAssetType(rawType)) {
      res.status(400).json({ error: "invalid_asset_type" });
      return;
    }
    typeFilter = rawType;
  }

  // Free-text search: resolved by the SHARED asset-search resolver (names,
  // hostnames, cloud accounts, native refs, exact UUIDs — one platform-wide
  // semantics), then applied as an id predicate so the type / at_risk filters
  // and the existing sort + pagination compose unchanged. A blank q is a no-op
  // (an empty search box submit must not 400 the page); an out-of-bounds one
  // is a 400 (same 2–120 bounds as every other search surface).
  let searchTerm: string | null = null;
  const rawSearch = req.query.q;
  if (rawSearch !== undefined && !(typeof rawSearch === "string" && rawSearch.trim().length === 0)) {
    searchTerm = normalizeAssetSearchTerm(rawSearch);
    if (searchTerm === null) {
      res.status(400).json({ error: "invalid_search" });
      return;
    }
  }

  // at_risk=true — the assets the executive "Assets at risk" tile counts (own_risk > 0
  // on the CURRENT applicability decision). It exists so that tile has a destination
  // that reproduces its number: without it, the only place the tile could send a
  // customer was the unscoped registry, which is not a drill-through, it is a shrug.
  // The predicate is built from DECISION_RISK, the same map the rollup scores with —
  // one definition, so the list and the tile cannot drift apart.
  const atRisk = req.query.at_risk === "true";

  const atRiskJoin = atRisk
    ? `LEFT JOIN current_decisions cd ON cd.asset_id = v.asset_id`
    : ``;
  const atRiskWhere = atRisk ? `AND ${sqlAssetAtRisk()}` : ``;
  const withCte = atRisk ? `WITH current_decisions AS (${sqlCurrentDecisionsCte("$1")})` : ``;

  // Resolve the term to canonical asset ids FIRST (type-narrowed, so a filtered
  // page never loses its own type's matches to the resolver cap), then filter
  // the list by id. Zero matches short-circuits to an honest empty envelope —
  // no point running the list queries against an empty id set.
  let searchAssetIds: string[] | null = null;
  if (searchTerm !== null) {
    const resolved = await resolveAssetSearch(pg, orgId, searchTerm, {
      ...(typeFilter ? { assetTypes: [typeFilter] } : {})
    });
    if (resolved.matches.length === 0) {
      res.status(200).json({ assets: [], total: 0, limit, offset });
      return;
    }
    searchAssetIds = resolved.matches.map((m) => m.asset_id);
  }

  // The id list is appended AFTER the fixed params, so its placeholder index
  // differs between the two queries: $5 in the rows query (after limit/offset),
  // $3 in the count query.
  const searchRowsWhere = searchAssetIds ? `AND v.asset_id = ANY($5::uuid[])` : ``;
  const searchCountWhere = searchAssetIds ? `AND v.asset_id = ANY($3::uuid[])` : ``;

  const rows = await pg.query(
    `${withCte}
     SELECT ${ASSET_COLS_V}
       FROM asset_registry_v v
       ${atRiskJoin}
      WHERE v.organization_id = $1
        AND ($2::text IS NULL OR v.asset_type = $2)
        ${atRiskWhere}
        ${searchRowsWhere}
      ORDER BY v.name ASC, v.asset_id ASC
      LIMIT $3 OFFSET $4`,
    searchAssetIds !== null
      ? [orgId, typeFilter, limit, offset, searchAssetIds]
      : [orgId, typeFilter, limit, offset]
  );

  const total = await pg.query(
    `${withCte}
     SELECT count(*)::int AS n
       FROM asset_registry_v v
       ${atRiskJoin}
      WHERE v.organization_id = $1
        AND ($2::text IS NULL OR v.asset_type = $2)
        ${atRiskWhere}
        ${searchCountWhere}`,
    searchAssetIds !== null ? [orgId, typeFilter, searchAssetIds] : [orgId, typeFilter]
  );

  res.status(200).json({
    assets: rows.rows,
    total: Number((total.rows[0] as Record<string, unknown>).n),
    limit,
    offset
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * EAR Phase 3a: unified create for the four DETAIL-BACKED types only
 * (cloud_resource / endpoint / api / identity_system — the unified surface is
 * their CRUD home). vendor / ai_system / application / database /
 * business_process keep their per-type routes (EAR-AD-1 federation — the
 * registry never replaces them). Insert + registration are one tx (asTenant).
 */
export async function createAsset(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const validated = validateAssetDetailCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const result = await createDetailAsset(orgId, validated.input);
  if ("error" in result) {
    if (result.error === "cap_exceeded") {
      res.status(409).json({
        error: "asset_cap_exceeded",
        detail: `Your plan allows up to ${result.cap} assets of this type.`
      });
      return;
    }
    res.status(409).json({ error: result.error });
    return;
  }
  res.status(201).json({ asset: result.row });
}

/** Canonical header (view row) + typed detail for one asset. */
export async function getAsset(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const header = await pg.query(
    `SELECT ${ASSET_COLS} FROM asset_registry_v
      WHERE organization_id = $1 AND asset_id = $2
      LIMIT 1`,
    [orgId, id]
  );
  if (header.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = header.rows[0] as { backing_kind: string; backing_id: string };

  // Typed detail for the detail-backed kinds (closed dispatch — never input).
  const detailSpec = Object.values(DETAIL_TABLE_SPEC).find((s) => s.table === row.backing_kind);
  let detail: Record<string, unknown> | null = null;
  if (detailSpec) {
    const d = await pg.query(
      `SELECT * FROM ${detailSpec.table} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [row.backing_id, orgId]
    );
    detail = (d.rows[0] as Record<string, unknown>) ?? null;
  }

  res.status(200).json({ asset: header.rows[0], detail });
}

// ─── ERIP E2.P3: connector-discovery view for one asset ───────────────────────
//
// Read-only, derived: gathers the connector observations that map to this asset
// — its own backing external_ref plus any other connector that observed the
// same normalized name — and returns the pure conflict-resolution + confidence
// summary (ERIP-AD-12). Never mutates canonical stores (ERIP-AD-8). Only
// connector-sourceable backings carry an external_ref (the 4 detail tables +
// enterprise_entities); vendor/ai_system-backed assets simply yield an empty
// discovery set.

/** Backing tables that carry a connector external_ref (safe SQL identifiers). */
const OBSERVABLE_BACKINGS: ReadonlySet<string> = new Set<string>([
  ...Object.values(DETAIL_TABLE_SPEC).map((s) => s.table),
  "enterprise_entities"
]);

interface ObservationRow {
  connector_id: string;
  external_ref: string;
  entity_type: string;
  name: string;
  stale: boolean;
  last_seen_at: Date | string;
  owner_hint: string | null;
  metadata: Record<string, string> | null;
}

export async function getAssetDiscovery(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const header = await pg.query(
    `SELECT name, backing_kind, backing_id FROM asset_registry_v
      WHERE organization_id = $1 AND asset_id = $2 LIMIT 1`,
    [orgId, id]
  );
  if (header.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { name, backing_kind, backing_id } = header.rows[0] as {
    name: string;
    backing_kind: string;
    backing_id: string;
  };

  // Resolve the backing external_ref only from tables known to carry one; the
  // interpolated identifier is a member of our own allowlist, never raw input.
  let externalRef: string | null = null;
  if (OBSERVABLE_BACKINGS.has(backing_kind)) {
    const b = await pg.query(
      `SELECT external_ref FROM ${backing_kind} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [backing_id, orgId]
    );
    externalRef = (b.rows[0] as { external_ref: string | null } | undefined)?.external_ref ?? null;
  }

  // Observations that map to this asset: own external_ref OR same normalized
  // name (cross-connector identity — different connectors mint different refs).
  const obs = await pg.query<ObservationRow>(
    `SELECT connector_id, external_ref, entity_type, name, stale, last_seen_at, owner_hint, metadata
       FROM connector_asset_observations
      WHERE organization_id = $1
        AND ( ($2::text IS NOT NULL AND external_ref = $2) OR lower(name) = lower($3) )`,
    [orgId, externalRef, name]
  );

  const facts: ObservationFact[] = [];
  for (const r of obs.rows) {
    const adapter = getConnector(r.connector_id);
    if (!adapter) continue; // an unranked source cannot participate in precedence
    facts.push({
      connector_id: r.connector_id,
      category: adapter.category,
      external_ref: r.external_ref,
      entity_type: r.entity_type,
      name: r.name,
      stale: r.stale,
      last_seen_at: r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : String(r.last_seen_at),
      owner_hint: r.owner_hint,
      metadata: r.metadata
    });
  }

  const discovery = summarizeDiscovery(facts, new Date());

  // ERIP-AD-13: owner discovery is SUGGEST-ONLY. Match the resolved owner hint
  // to an org user by email; the product layer decides whether to assign. Never
  // auto-assigns. Null when no hint or no matching user in this org.
  let suggestedOwner: { user_id: string; email: string; name: string | null } | null = null;
  const hint = discovery.effective_owner_hint?.value;
  if (hint && hint.includes("@")) {
    const u = await pg.query<{ id: string; email: string; name: string | null }>(
      `SELECT id, email, name FROM users
        WHERE organization_id = $1 AND lower(email) = lower($2) LIMIT 1`,
      [orgId, hint]
    );
    const row = u.rows[0];
    if (row) suggestedOwner = { user_id: row.id, email: row.email, name: row.name };
  }

  res.status(200).json({
    asset_id: id,
    discovery,
    suggested_owner: suggestedOwner,
    observations: facts.map((f) => ({
      connector_id: f.connector_id,
      category: f.category,
      external_ref: f.external_ref,
      entity_type: f.entity_type,
      name: f.name,
      stale: f.stale,
      last_seen_at: f.last_seen_at,
      owner_hint: f.owner_hint,
      metadata: f.metadata
    }))
  });
}

// ─── ERIP E3.P1: graph-aware risk propagation for one asset ───────────────────
//
// Read-only, derived (ERIP-AD-15): resolve the asset's outbound neighbourhood,
// seed each node's own-risk from its CURRENT applicability decisions
// (ERIP-AD-16), and run the pure propagation engine (ERIP-AD-17). Returns the
// seed's direct / inherited / total risk with a full contributor trace. Never
// mutates canonical stores.

export async function getAssetRiskPropagation(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const depth = parseBoundedInt(req.query.depth, DEFAULT_DEPTH, MAX_DEPTH);
  if (depth === null) {
    res.status(400).json({ error: "invalid_depth" });
    return;
  }

  const header = await pg.query(
    `SELECT backing_kind, backing_id FROM asset_registry_v
      WHERE organization_id = $1 AND asset_id = $2 LIMIT 1`,
    [orgId, id]
  );
  if (header.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { backing_kind, backing_id } = header.rows[0] as { backing_kind: string; backing_id: string };
  const seed = graphNodeForBacking(backing_kind, backing_id, id);

  const neighbourhood = await resolveNeighborhood(orgId, seed.node_type, seed.node_id, depth);
  const ownRisk = await ownRiskForNodes(
    orgId,
    neighbourhood.nodes.map((n) => ({ node_type: n.node_type, node_id: n.node_id }))
  );
  const riskNodes: RiskNode[] = neighbourhood.nodes.map((n) => ({
    node_type: n.node_type,
    node_id: n.node_id,
    own_risk: ownRisk.get(`${n.node_type}:${n.node_id}`) ?? 0,
    depth: n.depth
  }));

  const risk = propagateRisk(seed, riskNodes);

  res.status(200).json({
    asset_id: id,
    seed_node: seed,
    depth: neighbourhood.depth,
    neighbourhood_size: neighbourhood.nodes.length,
    risk
  });
}

// ─── EAR P6: update / delete for detail-backed assets ─────────────────────────
//
// The unified surface is the CRUD home for the four detail-backed types ONLY
// (EAR-AD-1 — vendor/ai_system/entity-backed assets are managed on their
// authoritative per-type routes; mutating them here returns 409).

/** Resolve a registry id to its detail-backed type, or a typed refusal. */
async function resolveDetailBacked(
  orgId: string,
  id: string
): Promise<
  | { assetType: DetailBackedType; backingId: string; assetId: string }
  | { status: 400 | 404 | 409; error: string; detail?: string }
> {
  if (!UUID_RE.test(id)) return { status: 400, error: "invalid_id" };
  const reg = await pg.query(
    `SELECT id, backing_kind, backing_id FROM assets
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId]
  );
  const row = reg.rows[0] as { id: string; backing_kind: string; backing_id: string } | undefined;
  if (!row) return { status: 404, error: "not_found" };
  const spec = Object.entries(DETAIL_TABLE_SPEC).find(([, v]) => v.table === row.backing_kind);
  if (!spec) {
    return {
      status: 409,
      error: "not_detail_backed",
      detail: "This asset is managed on its own per-type route (vendors / AI systems / enterprise entities)."
    };
  }
  return { assetType: spec[0] as DetailBackedType, backingId: row.backing_id, assetId: row.id };
}

function auditActor(req: Request): { actorApiKeyId: string | null; actorUserId: string | null; ipAddress: string | null } {
  return {
    actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
    actorUserId: (req as { userId?: string }).userId ?? null,
    ipAddress: req.ip ?? null
  };
}

export async function updateAsset(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const resolved = await resolveDetailBacked(orgId, String(req.params.id ?? ""));
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error, ...(resolved.detail ? { detail: resolved.detail } : {}) });
    return;
  }
  const validated = validateAssetDetailUpdate(resolved.assetType, req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const result = await updateDetailAsset(orgId, resolved.assetType, resolved.backingId, validated.input.patch);
  if ("error" in result) {
    res.status(result.error === "not_found" ? 404 : 409).json({ error: result.error });
    return;
  }
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "asset.updated",
    resourceType: "asset",
    resourceId: resolved.assetId,
    payload: { asset_type: resolved.assetType, fields: Object.keys(validated.input.patch).sort() }
  });
  res.status(200).json({ asset: { ...result.row, asset_id: resolved.assetId } });
}

export async function deleteAsset(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const resolved = await resolveDetailBacked(orgId, String(req.params.id ?? ""));
  if ("status" in resolved) {
    res.status(resolved.status).json({ error: resolved.error, ...(resolved.detail ? { detail: resolved.detail } : {}) });
    return;
  }
  const result = await deleteDetailAsset(orgId, resolved.assetType, resolved.backingId);
  if (!result.deleted) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "asset.deleted",
    resourceType: "asset",
    resourceId: resolved.assetId,
    payload: { asset_type: resolved.assetType }
  });
  res.status(200).json({ deleted: true });
}

/**
 * EAR P16: bulk CSV/XLSX import for the four detail-backed asset types
 * (cloud_resource / endpoint / api / identity_system). The sibling of
 * POST /api/enterprise-context/import for the assets spine — same preview/commit
 * contract, same per-row plan shape — reusing the shared parser (parseImportFile),
 * the shared dedup/cap precedence (planAssetImport → planRows), the existing
 * create-validator (validateAssetDetailCreate), and the existing create lane
 * (createDetailAsset). No new validation, dedup, or cap logic.
 *
 *   POST /api/assets/import?asset_type=<t>&mode=preview|commit  (multipart file)
 *   preview (default): parse → plan → return per-row statuses. Writes nothing.
 *   commit:            persist the `ok` rows in ONE tenant transaction (asTenant).
 *
 * The other six asset types (vendor / ai_system / application / database /
 * business_process / generic) import through the ECL path (EAR-AD-1 federation);
 * this route rejects them so there is one home per type.
 */
export async function importAssets(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const assetType = req.query.asset_type;
  if (!isDetailBackedType(assetType)) {
    res.status(400).json({
      error: "invalid_asset_type",
      detail:
        `asset_type must be one of: ${DETAIL_BACKED_TYPES.join(", ")}. ` +
        "vendor / ai_system / application / database / business_process / generic import via /api/enterprise-context/import."
    });
    return;
  }

  const mode = req.query.mode ?? "preview";
  if (mode !== "preview" && mode !== "commit") {
    res.status(400).json({ error: "invalid_mode", detail: "mode must be preview or commit" });
    return;
  }

  const file = (req as { file?: { buffer: Buffer; originalname: string } }).file;
  if (!file) {
    res.status(400).json({ error: "no_file_uploaded" });
    return;
  }

  const parsed = await parseImportFile(file.buffer, file.originalname);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const keys = await assetImportExistingKeys(assetType, orgId);
  const headroom = await assetImportCapHeadroom(assetType, orgId);
  const plan = planAssetImport({ assetType, rows: parsed.parsed.rows, existingKeys: keys, capHeadroom: headroom });

  if (mode === "preview") {
    res.status(200).json({ mode: "preview", truncated: parsed.parsed.truncated, ...plan });
    return;
  }

  // commit — persist the ok rows in this tenant transaction. createDetailAsset
  // ON CONFLICT DO NOTHING classifies late collisions as errors we skip (a row
  // that raced in between preview and commit), never an aborted tx.
  let committed = 0;
  for (const row of plan.rows) {
    if (row.status === "ok" && row.normalized) {
      const result = await createDetailAsset(orgId, row.normalized);
      if (!("error" in result)) committed++;
    }
  }

  logger.info(
    { event: "asset_registry_import", organizationId: orgId, assetType, committed, planned: plan.summary.ok },
    "Asset registry import committed"
  );
  writeAuditEvent({
    organizationId: orgId,
    ...auditActor(req),
    eventType: "asset.imported",
    resourceType: "asset_import",
    resourceId: null,
    payload: { asset_type: assetType, committed, summary: plan.summary }
  });

  res.status(200).json({ mode: "commit", committed, truncated: parsed.parsed.truncated, ...plan });
}

const chain = [
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

/** Import upload: in-memory, single file, 5 MB — mirrors the ECL importer. */
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

router.get("/assets", ...chain, asTenant(listAssets));
// POST /assets/import — literal segment; distinct from POST /assets by path, so
// no route shadowing. multer parses the multipart body before the tenant tx.
router.post("/assets/import", ...chain, importUpload.single("file"), asTenant(importAssets));
router.get("/assets/:id/discovery", ...chain, asTenant(getAssetDiscovery));
// E3.P1: additionally fenced on the Risk Intelligence flag (404s independently).
router.get("/assets/:id/risk-propagation", riskIntelligenceFeatureFlag, ...chain, asTenant(getAssetRiskPropagation));
router.get("/assets/:id", ...chain, asTenant(getAsset));
router.post("/assets", ...chain, asTenant(createAsset));
router.patch("/assets/:id", ...chain, asTenant(updateAsset));
router.delete("/assets/:id", ...chain, asTenant(deleteAsset));

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// C4 part 2 (ADR-0003 D1-B) — asset ↔ canonical-product ATTESTATION.
//
// The human override on product identity. `asset_product_identities` (20260905)
// records what EVIDENCE says an asset RUNS: connectors and SBOM write machine rows;
// this is the one path a PERSON can write, and it may only ever write
// provenance='attestation'.
//
// Why that matters: confidence is keyed to provenance (IDENTITY_CONFIDENCE), and that
// confidence is the ERG R2 gate deciding whether a finding may be called `affected`.
// If a human could post provenance='sbom', they could mint 95-confidence "evidence"
// from an opinion. So provenance is not an input at all — it is a constant, and the
// validator rejects any attempt to supply it.
//
// ADR-0003 D1: attestation is SUPPORTING EVIDENCE. It never becomes the primary source
// of truth and never redefines canonical relationships — nothing here writes `assets`,
// `enterprise_entities`, or any canonical context table. Canonical enterprise context
// remains authoritative.
//
// Ambiguity is preserved, never resolved by fiat: an attestation ADDS a candidate. If
// the org attests two assets to one product, tenantAssetResolver still returns
// `ambiguous` and the engine still routes it to `needs_review` — a human declaring
// something does not collapse a genuine ambiguity.
// ─────────────────────────────────────────────────────────────────────────────

/** The asset must exist, be active, and belong to THIS org. Never trust the path param. */
async function assertOwnedActiveAsset(
  organizationId: string,
  assetId: string
): Promise<boolean> {
  const r = await pg.query(
    `SELECT 1
       FROM assets a
       JOIN asset_registry_v rv
         ON rv.asset_id = a.id AND rv.organization_id = a.organization_id
      WHERE a.organization_id = $1 AND a.id = $2 AND rv.status = 'active'
      LIMIT 1`,
    [organizationId, assetId]
  );
  return (r.rowCount ?? 0) > 0;
}

async function listAssetProductIdentities(req: Request, res: Response): Promise<void> {
  const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const assetId = String(req.params["id"] ?? "");

  if (!(await assertOwnedActiveAsset(organizationId, assetId))) {
    res.status(404).json({ error: "asset_not_found" });
    return;
  }

  // Ordered by AUTHORITY, so the reader sees what the resolver will prefer.
  const rows = await pg.query(
    `SELECT api.id, api.asset_id, api.canonical_product_id, api.provenance, api.confidence,
            api.evidence_ref, api.attested_by_user_id, api.created_at,
            cp.canonical_key, cp.display_name, cp.vendor_canonical, cp.product_canonical
       FROM asset_product_identities api
       JOIN canonical_products cp ON cp.id = api.canonical_product_id
      WHERE api.organization_id = $1 AND api.asset_id = $2
      ORDER BY CASE api.provenance
                 WHEN 'attestation' THEN 0 WHEN 'sbom' THEN 1
                 WHEN 'connector'   THEN 2 ELSE 3 END,
               api.confidence DESC, api.created_at DESC`,
    [organizationId, assetId]
  );

  res.status(200).json({ asset_id: assetId, identities: rows.rows, count: rows.rows.length });
}

async function createAssetProductAttestation(req: Request, res: Response): Promise<void> {
  const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const actorUserId = (req.userId as string | undefined) ?? null;
  if (!actorUserId) {
    // The 20260905 CHECK requires an actor for an attestation, and rightly so: an
    // unattributable human assertion is not evidence. An API-key caller cannot attest.
    res.status(403).json({
      error: "attestation_requires_user",
      detail: "an attestation must be attributable to a person; use a user session.",
    });
    return;
  }

  const validated = validateAttestationCreate({
    ...(req.body as Record<string, unknown>),
    asset_id: String(req.params["id"] ?? ""),
  });
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { asset_id, canonical_product_id, evidence_ref } = validated.input;

  if (!(await assertOwnedActiveAsset(organizationId, asset_id))) {
    res.status(404).json({ error: "asset_not_found" });
    return;
  }

  // canonical_products is ORG-NEUTRAL reference data — existence check only, no org filter
  // (there is no org column to filter on). It is not tenant data and carries none.
  const prod = await pg.query(`SELECT 1 FROM canonical_products WHERE id = $1 LIMIT 1`, [
    canonical_product_id,
  ]);
  if ((prod.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "canonical_product_not_found" });
    return;
  }

  // provenance and confidence are DERIVED, never supplied (see validator).
  const inserted = await pg.query(
    `INSERT INTO asset_product_identities
       (organization_id, asset_id, canonical_product_id, provenance, confidence,
        evidence_ref, attested_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (organization_id, asset_id, canonical_product_id, provenance)
       DO UPDATE SET evidence_ref = EXCLUDED.evidence_ref,
                     attested_by_user_id = EXCLUDED.attested_by_user_id,
                     updated_at = NOW()
     RETURNING id, asset_id, canonical_product_id, provenance, confidence, evidence_ref,
               attested_by_user_id, created_at`,
    [
      organizationId,
      asset_id,
      canonical_product_id,
      HUMAN_PROVENANCE,
      IDENTITY_CONFIDENCE[HUMAN_PROVENANCE],
      evidence_ref,
      actorUserId,
    ]
  );

  logger.info(
    {
      event: "asset_product_attestation_created",
      organizationId,
      assetId: asset_id,
      canonicalProductId: canonical_product_id,
      actorUserId,
    },
    "asset↔product attestation recorded"
  );

  res.status(201).json({ identity: inserted.rows[0] });
}

async function deleteAssetProductAttestation(req: Request, res: Response): Promise<void> {
  const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const assetId = String(req.params["id"] ?? "");
  const identityId = String(req.params["identityId"] ?? "");

  // ONLY an attestation may be withdrawn. Machine-observed rows (connector/sbom) are a
  // record of what was OBSERVED — deleting one through the human path would let a person
  // erase evidence they merely disagree with. Drift belongs to the connector that owns it.
  const del = await pg.query(
    `DELETE FROM asset_product_identities
      WHERE organization_id = $1 AND asset_id = $2 AND id = $3
        AND provenance = $4
      RETURNING id`,
    [organizationId, assetId, identityId, HUMAN_PROVENANCE]
  );

  if ((del.rowCount ?? 0) === 0) {
    res.status(404).json({ error: "attestation_not_found" });
    return;
  }

  logger.info(
    { event: "asset_product_attestation_withdrawn", organizationId, assetId, identityId },
    "asset↔product attestation withdrawn"
  );
  res.status(204).send();
}

// Additionally fenced on the applicability flag: the surface does not exist while the
// convergence is dark (404), so flag-off behaviour is byte-identical.
router.get(
  "/assets/:id/product-identities",
  signalApplicabilityFeatureFlag,
  ...chain,
  asTenant(listAssetProductIdentities)
);
router.post(
  "/assets/:id/product-identities",
  signalApplicabilityFeatureFlag,
  ...chain,
  asTenant(createAssetProductAttestation)
);
router.delete(
  "/assets/:id/product-identities/:identityId",
  signalApplicabilityFeatureFlag,
  ...chain,
  asTenant(deleteAssetProductAttestation)
);
