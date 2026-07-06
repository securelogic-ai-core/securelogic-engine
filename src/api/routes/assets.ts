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
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { isAssetType } from "../lib/assetRegistry.js";
import {
  validateAssetDetailCreate,
  validateAssetDetailUpdate,
  DETAIL_TABLE_SPEC,
  type DetailBackedType
} from "../lib/assetDetailValidation.js";
import {
  createDetailAsset,
  updateDetailAsset,
  deleteDetailAsset
} from "../lib/assetDetailPersistence.js";
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

  const rows = await pg.query(
    `SELECT ${ASSET_COLS}
       FROM asset_registry_v
      WHERE organization_id = $1
        AND ($2::text IS NULL OR asset_type = $2)
      ORDER BY name ASC, asset_id ASC
      LIMIT $3 OFFSET $4`,
    [orgId, typeFilter, limit, offset]
  );

  const total = await pg.query(
    `SELECT count(*)::int AS n
       FROM asset_registry_v
      WHERE organization_id = $1
        AND ($2::text IS NULL OR asset_type = $2)`,
    [orgId, typeFilter]
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

const chain = [
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/assets", ...chain, asTenant(listAssets));
router.get("/assets/:id/discovery", ...chain, asTenant(getAssetDiscovery));
// E3.P1: additionally fenced on the Risk Intelligence flag (404s independently).
router.get("/assets/:id/risk-propagation", riskIntelligenceFeatureFlag, ...chain, asTenant(getAssetRiskPropagation));
router.get("/assets/:id", ...chain, asTenant(getAsset));
router.post("/assets", ...chain, asTenant(createAsset));
router.patch("/assets/:id", ...chain, asTenant(updateAsset));
router.delete("/assets/:id", ...chain, asTenant(deleteAsset));

export default router;
