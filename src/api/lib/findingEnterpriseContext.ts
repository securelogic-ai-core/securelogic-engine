/**
 * findingEnterpriseContext.ts — C4 part 3 (ADR-0003 D2-A): the enterprise context a
 * finding is being decided IN.
 *
 * READ-ONLY. Composes at read. Writes NOTHING — no canonical store is mutated, so
 * ERIP-AD-8 / AD-10 stand unamended (that is precisely why D2 was ruled "narrow").
 *
 * WHY THIS EXISTS
 *   Two engines already compute this and nobody reads them:
 *     - `organizations.{regulated, handles_pii, safety_critical, scale}` — set since
 *       20260411, read ONLY by postureSnapshot. The Decision Workspace computes business
 *       impact with zero knowledge of whether the org is regulated or handles PII.
 *     - `graphImpactAnalysis.analyzeGraphImpact` — already produces a criticality-weighted
 *       `business_impact_score` + `blast_radius` over the asset graph, and is consumed by
 *       exactly one route (knowledgeGraph).
 *   This module wires them into the finding. It does not invent a third model.
 *
 * NO NEW TRAVERSAL (AD-13): `enterpriseGraphResolver.resolveNeighborhood` remains the
 * single graph-traversal authority. We call it; we do not re-walk anything.
 *
 * NO GUESSED IMPACT. Every field is either sourced or explicitly marked unsourced. The
 * states are distinct on purpose, because "we looked and found nothing", "we could not
 * look", and "we tried and failed" are three different things to a person deciding
 * whether to page someone at 2am:
 *
 *   resolved       — a graph root was found and the blast radius was computed
 *   none_found     — a root existed; the graph has no reachable dependencies
 *   not_applicable — this finding has NO graph-representable affected entity to root at
 *   resolver_error — the traversal failed. We say so. We do not report 0 and move on.
 */

import { analyzeGraphImpact, type EnrichedNode } from "./graphImpactAnalysis.js";
import { logger } from "../infra/logger.js";

/**
 * The graph modules construct the `pg` pool AT IMPORT, so a static import here would make
 * findingContextResolver — and therefore its unit test, which only exercises pure
 * functions — require a live DATABASE_URL just to be loaded. It did not before, and that
 * purity is worth keeping (the same reason canonicalProduct.ts is careful to have no
 * import side effect). Loaded lazily, at the moment we actually traverse.
 */
async function graphDeps() {
  const [resolver, labeling, ownRisk] = await Promise.all([
    import("./enterpriseGraphResolver.js"),
    import("./graphLabeling.js"),
    import("./assetOwnRisk.js"),
  ]);
  return {
    resolveNeighborhood: resolver.resolveNeighborhood,
    labelNodes: labeling.labelNodes,
    criticalityForNodes: labeling.criticalityForNodes,
    ownRiskForNodes: ownRisk.ownRiskForNodes,
  };
}

export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** The graph identity a blast radius can be rooted at. */
export interface ContextRoot {
  node_type: "vendor" | "ai_system";
  node_id: string;
  label: string;
}

export type BlastRadiusStatus = "resolved" | "none_found" | "not_applicable" | "resolver_error";

export interface FindingEnterpriseContext {
  org_profile: {
    /**
     * `assessed`      — at least one profile flag is off its default, so someone set it.
     * `defaults_only` — every value is at its default. The columns are NOT NULL with
     *                   defaults, so the platform genuinely CANNOT distinguish "a small,
     *                   unregulated org" from "an org nobody ever asked". Saying
     *                   "assessed: not regulated" would be a claim we cannot support.
     */
    status: "assessed" | "defaults_only";
    regulated: boolean;
    handles_pii: boolean;
    safety_critical: boolean;
    scale: string;
    /** Plain-language note the UI renders verbatim. Never a fabricated conclusion. */
    note: string;
  };
  blast_radius: {
    status: BlastRadiusStatus;
    reason: string;
    root: ContextRoot | null;
    /** 0–100, from analyzeGraphImpact. NULL whenever status !== 'resolved'. */
    business_impact_score: number | null;
    business_impact_band: string | null;
    /** Nodes reachable from the root (root excluded). */
    dependency_count: number;
    /** Dependencies carrying non-zero own-risk — the ones worth naming. */
    at_risk: Array<{ label: string | null; depth: number; own_risk: number; criticality: string | null }>;
  };
}

const DEPTH = 2;

/** Cap what we send to the UI. The full list belongs on the graph page, not here. */
const MAX_AT_RISK = 5;

/**
 * The org profile, verbatim. No inference: these four columns are the only org-level
 * risk context the platform holds, and they are admin-set (adminOrganizations.ts).
 */
async function readOrgProfile(
  client: Queryable,
  organizationId: string
): Promise<FindingEnterpriseContext["org_profile"]> {
  const r = await client.query(
    `SELECT regulated, handles_pii, safety_critical, scale
       FROM organizations WHERE id = $1`,
    [organizationId]
  );
  const row = r.rows[0];
  const regulated = row?.regulated === true;
  const handles_pii = row?.handles_pii === true;
  const safety_critical = row?.safety_critical === true;
  const scale = typeof row?.scale === "string" ? row.scale : "Small";

  const atDefaults = !regulated && !handles_pii && !safety_critical && scale === "Small";

  return {
    status: atDefaults ? "defaults_only" : "assessed",
    regulated,
    handles_pii,
    safety_critical,
    scale,
    note: atDefaults
      ? "Organisation profile is at its defaults — it has not been set. This is not the same as 'no regulatory exposure'."
      : [
          regulated ? "regulated" : null,
          handles_pii ? "handles PII" : null,
          safety_critical ? "safety-critical" : null,
          `${scale} scale`,
        ]
          .filter(Boolean)
          .join(" · "),
  };
}

/**
 * Resolve the blast radius for a finding, rooted at the first graph-representable
 * affected entity. Vendors and AI systems are graph nodes; controls and obligations are
 * canonical GRC objects and structurally are not — a finding affecting only those has
 * NOTHING to root at, and that is `not_applicable`, not an empty result.
 */
export async function resolveFindingEnterpriseContext(
  client: Queryable,
  organizationId: string,
  affected: {
    vendors: Array<{ id: string; name: string }>;
    ai_systems: Array<{ id: string; name: string }>;
  }
): Promise<FindingEnterpriseContext> {
  const org_profile = await readOrgProfile(client, organizationId);

  const root: ContextRoot | null =
    affected.vendors.length > 0
      ? { node_type: "vendor", node_id: affected.vendors[0]!.id, label: affected.vendors[0]!.name }
      : affected.ai_systems.length > 0
        ? { node_type: "ai_system", node_id: affected.ai_systems[0]!.id, label: affected.ai_systems[0]!.name }
        : null;

  if (!root) {
    return {
      org_profile,
      blast_radius: {
        status: "not_applicable",
        reason:
          "This finding has no vendor or AI system to root a blast radius at. Controls and obligations are not graph nodes.",
        root: null,
        business_impact_score: null,
        business_impact_band: null,
        dependency_count: 0,
        at_risk: [],
      },
    };
  }

  try {
    const { resolveNeighborhood, labelNodes, criticalityForNodes, ownRiskForNodes } =
      await graphDeps();

    // AD-13: the single traversal authority. We do not re-walk the graph.
    // INBOUND: "what of OURS depends on this vendor / AI system?" — the blast radius of a
    // compromise. Outbound would ask "what does Microsoft depend on", find nothing (every
    // dependency edge points INTO the vendor) and report "nothing depends on Microsoft"
    // while SharePoint sits one hop away. See enterpriseGraphResolver.TraversalDirection.
    const hood = await resolveNeighborhood(
      organizationId,
      root.node_type,
      root.node_id,
      DEPTH,
      client,
      "inbound"
    );
    const keys = hood.nodes.map((n: { node_type: string; node_id: string }) => ({ node_type: n.node_type, node_id: n.node_id }));
    const [labels, ownRisk, criticality] = await Promise.all([
      labelNodes(organizationId, keys, client),
      ownRiskForNodes(organizationId, keys, client),
      criticalityForNodes(organizationId, hood.nodes.map((n: { node_id: string }) => n.node_id), client),
    ]);

    const enriched: EnrichedNode[] = hood.nodes.map((n: { node_type: string; node_id: string; depth: number }) => ({
      node_type: n.node_type,
      node_id: n.node_id,
      label: labels.get(`${n.node_type}:${n.node_id}`) ?? null,
      depth: n.depth,
      own_risk: ownRisk.get(`${n.node_type}:${n.node_id}`) ?? 0,
      criticality: criticality.get(n.node_id) ?? null,
    }));

    const analysis = analyzeGraphImpact(enriched, hood.edges);

    if (analysis.dependencies.length === 0) {
      return {
        org_profile,
        blast_radius: {
          status: "none_found",
          reason: `No asset or AI system in your enterprise graph depends on ${root.label}.`,
          root,
          // An honest zero: we looked, the graph is genuinely empty here.
          business_impact_score: analysis.business_impact_score,
          business_impact_band: analysis.business_impact_band,
          dependency_count: 0,
          at_risk: [],
        },
      };
    }

    return {
      org_profile,
      blast_radius: {
        status: "resolved",
        reason: `${analysis.dependencies.length} of your asset(s) depend on ${root.label}.`,
        root,
        business_impact_score: analysis.business_impact_score,
        business_impact_band: analysis.business_impact_band,
        dependency_count: analysis.dependencies.length,
        at_risk: analysis.at_risk_dependencies.slice(0, MAX_AT_RISK).map((d) => ({
          label: d.label,
          depth: d.depth,
          own_risk: d.own_risk,
          criticality: d.criticality,
        })),
      },
    };
  } catch (err) {
    // A failed traversal is NOT a zero blast radius. Reporting 0 here would be the
    // single most dangerous lie this panel could tell: it reads exactly like "nothing
    // depends on this", which is what someone checks before deciding not to act.
    logger.warn(
      { event: "finding_enterprise_context_failed", organizationId, root, err },
      "blast-radius resolution failed — reporting resolver_error, NOT an empty radius"
    );
    return {
      org_profile,
      blast_radius: {
        status: "resolver_error",
        reason: "The enterprise graph could not be resolved. This is not the same as no impact.",
        root,
        business_impact_score: null,
        business_impact_band: null,
        dependency_count: 0,
        at_risk: [],
      },
    };
  }
}
