/**
 * findingContextResolver.ts — ERIP Package 3 (Decision Workspace), Phase 3.0.
 *
 * Read-only composition layer that gathers, for a single finding, everything the
 * Decision Workspace needs so the customer never has to page-hop: affected
 * entities (vendors / AI systems / controls / obligations), the supporting
 * canonical Intelligence Events (+ their sources and timeline), evidence, related
 * findings, the owner, the activity log, and "what's changed" since a marker.
 *
 * NO schema change. Composes existing canonical tables. Every customer-data query
 * is scoped by organization_id, sourced from the caller (never request input).
 * Intelligence Events are GLOBAL (no organization_id) and are reached only via the
 * finding's own org-scoped source references or org-scoped signal links.
 *
 * The `client` is any pg-queryable — the route passes the tenant-aware `pg`; the
 * isolation test passes a raw Pool. Isolation holds because every predicate here
 * carries `organization_id = $org` regardless of the client.
 */

import { logger } from "../infra/logger.js";
import { sqlFindingActive } from "./metricDefinitions.js";
import {
  resolveFindingEnterpriseContext,
  type FindingEnterpriseContext,
} from "./findingEnterpriseContext.js";
import {
  computeFindingRiskScore,
  assessBusinessImpact,
  type FindingRiskScore,
  type BusinessImpact,
  type AffectedResolution,
  type AffectedResolutions,
} from "./findingRiskScore.js";

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export type AffectedEntityType = "vendor" | "ai_system" | "control" | "obligation";

export interface FindingAffectedEntity {
  type: AffectedEntityType;
  id: string;
  name: string;
}

/**
 * A matcher suggestion still awaiting human review (pending in
 * signal_match_suggestions). Surfaced SEPARATELY from `affected` — ambiguity is
 * shown as ambiguity, never promoted into displayed certainty (IQP / R2).
 */
export interface FindingCandidateEntity {
  type: AffectedEntityType;
  id: string;
  name: string;
  status: "needs_review";
  match_reason: string | null;
  match_score: number | null;
}

export interface FindingContext {
  finding: {
    id: string;
    source_type: string;
    source_id: string | null;
    decision_state: string;
    /** System-derived operational axis (finding-lifecycle-spec §1.1). */
    operational_status: string;
  };
  risk: FindingRiskScore;
  business_impact: BusinessImpact;
  owner: { id: string; email: string } | null;
  affected: {
    vendors: FindingAffectedEntity[];
    ai_systems: FindingAffectedEntity[];
    controls: FindingAffectedEntity[];
    obligations: FindingAffectedEntity[];
    /**
     * Context Contract: per-bucket resolution outcome so the UI can distinguish
     * an honest zero (`none_found`) from a dimension the resolver has no path
     * for on this source type (`not_applicable`). Empty ≠ zero ≠ unknowable.
     */
    resolution: AffectedResolutions;
    /**
     * Matcher suggestions pending human review — candidate links, NOT affected
     * entities. Never merged into the buckets above.
     */
    candidates: FindingCandidateEntity[];
  };
  intelligence: {
    events: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
    timeline: Array<Record<string, unknown>>;
    /**
     * The cyber_signals this finding resolves to, after the intelligence_event_sources
     * bridge has run. Exposed so the UI can scope the suggested-links review queue
     * to THIS finding — the queue's engine route filters on signal_id, and the
     * client cannot otherwise derive it: for an `intelligence_event`-sourced
     * finding the signal id is reachable only through the bridge, and source_id is
     * the EVENT id, not a signal id.
     */
    signal_ids: string[];
  };
  evidence: Array<Record<string, unknown>>;
  /**
   * Tiers 1–4 of the relationship hierarchy, best-tier-first. Each row carries
   * `relation_tier` (1–4) and `relation`. Tier 5 (vendor) is NEVER here — see
   * `related_context.same_vendor`.
   */
  related_findings: Array<Record<string, unknown>>;
  /**
   * Tier 5 — supporting context only. Same-vendor findings are summarised as a
   * COUNT per vendor, never enumerated: vendor must not become the organizing
   * principle of the workflow.
   */
  related_context: {
    same_vendor: Array<{ vendor_id: string; vendor_name: string; finding_count: number }>;
  };
  /**
   * C4 part 3 (ADR-0003 D2-A) — the enterprise context this finding is being decided IN:
   * the org's risk profile and the blast radius of the affected entity, both DERIVED at
   * read from engines that already existed and were never consumed here. Writes nothing.
   */
  enterprise_context: FindingEnterpriseContext;
  activity: Array<Record<string, unknown>>;
  whats_changed: { since: string | null; changes: Array<{ label: string; at: string }> };
}

export interface IntelRefs {
  signalIds: string[];
  eventIds: string[];
}

/**
 * PURE: the direct intelligence references a finding's source points at, before
 * any DB expansion. `cyber_signal`/`signal` → a cyber_signals id; `intelligence_event`
 * → an intelligence_events id. Assessment-sourced findings carry no intelligence ref
 * here — their affected entities are resolved from the assessment record instead
 * (see `resolveAssessmentAffected`); `applicability_assessment` additionally bridges to
 * its signal for supporting intelligence (handled in `resolveFindingContext`).
 */
export function directIntelRefs(sourceType: string, sourceId: string | null): IntelRefs {
  if (!sourceId) return { signalIds: [], eventIds: [] };
  if (sourceType === "intelligence_event") return { signalIds: [], eventIds: [sourceId] };
  if (sourceType === "cyber_signal" || sourceType === "signal") return { signalIds: [sourceId], eventIds: [] };
  return { signalIds: [], eventIds: [] };
}

/** Single-entity affected-context resolution for assessment-family findings. */
export interface AssessmentAffectedSpec {
  assessmentTable: string;
  entityFk: string;
  entityTable: string;
  nameCol: string;
  type: AffectedEntityType;
}

/**
 * PURE map: for assessment-sourced findings, the finding's `source_id` points at an
 * assessment row whose FK identifies the entity the assessment is ABOUT. That entity
 * is the finding's primary affected context. Keys are `findings.source_type` values;
 * table/column names are constants (never request input) — same interpolation
 * discipline as the signal-link `affected()` helper below.
 */
export const ASSESSMENT_AFFECTED_MAP: Record<string, AssessmentAffectedSpec> = {
  vendor_review: { assessmentTable: "vendor_assessments", entityFk: "vendor_id", entityTable: "vendors", nameCol: "name", type: "vendor" },
  vendor_cycle_review: { assessmentTable: "vendor_reviews", entityFk: "vendor_id", entityTable: "vendors", nameCol: "name", type: "vendor" },
  control_test: { assessmentTable: "control_assessments", entityFk: "control_id", entityTable: "controls", nameCol: "name", type: "control" },
  ai_review: { assessmentTable: "governance_reviews", entityFk: "ai_system_id", entityTable: "ai_systems", nameCol: "name", type: "ai_system" },
  ai_governance_review: { assessmentTable: "ai_governance_assessments", entityFk: "ai_system_id", entityTable: "ai_systems", nameCol: "name", type: "ai_system" },
  obligation_review: { assessmentTable: "obligation_assessments", entityFk: "obligation_id", entityTable: "obligations", nameCol: "title", type: "obligation" },
  assessment: { assessmentTable: "assessments", entityFk: "vendor_id", entityTable: "vendors", nameCol: "name", type: "vendor" },
};

/** PURE: per-affected-type name lookup, used to resolve applicability via_target ids. */
const ENTITY_NAME_SOURCE: Record<AffectedEntityType, { table: string; nameCol: string }> = {
  vendor: { table: "vendors", nameCol: "name" },
  ai_system: { table: "ai_systems", nameCol: "name" },
  control: { table: "controls", nameCol: "name" },
  obligation: { table: "obligations", nameCol: "title" },
};

interface AffectedBuckets {
  vendors: FindingAffectedEntity[];
  ai_systems: FindingAffectedEntity[];
  controls: FindingAffectedEntity[];
  obligations: FindingAffectedEntity[];
}

const EMPTY_AFFECTED: () => AffectedBuckets = () => ({ vendors: [], ai_systems: [], controls: [], obligations: [] });

const BUCKET_OF: Record<AffectedEntityType, keyof AffectedBuckets> = {
  vendor: "vendors",
  ai_system: "ai_systems",
  control: "controls",
  obligation: "obligations",
};

/**
 * PURE (Context Contract): which affected buckets have a resolution path that
 * actually RAN for this finding. Drives the per-bucket resolution status —
 * a bucket with no runnable path is `not_applicable` (empty ≠ zero), one that
 * ran with no rows is an honest `none_found`, one with rows is `resolved`.
 *
 * Paths:
 *  - signal-link path (signal_*_links) — runs for all four buckets when the
 *    finding reaches ≥1 signal id (directly or via the event bridge);
 *  - event-native vendor path (intelligence_events.affected_vendor → vendors,
 *    the SAME lower(trim(name)) match that gated the finding's creation in
 *    eventFindingStore.isRelevantToOrg) — runs for vendors when ≥1 event id;
 *  - assessment source-record walk — runs for the bucket(s) the source's
 *    assessment family is about (ASSESSMENT_AFFECTED_MAP / dependency / risk /
 *    applicability).
 */
export function affectedPathsRan(
  sourceType: string,
  hasSignals: boolean,
  hasEvents: boolean
): Record<keyof AffectedBuckets, boolean> {
  const ran: Record<keyof AffectedBuckets, boolean> = {
    vendors: hasSignals,
    ai_systems: hasSignals,
    controls: hasSignals,
    obligations: hasSignals,
  };
  if (hasEvents) ran.vendors = true;

  const spec = ASSESSMENT_AFFECTED_MAP[sourceType];
  if (spec) ran[BUCKET_OF[spec.type]] = true;
  if (sourceType === "dependency_review") ran.vendors = true;
  if (sourceType === "risk") {
    ran.controls = true;
    ran.obligations = true;
  }
  if (sourceType === "applicability_assessment") {
    ran.vendors = ran.ai_systems = ran.controls = ran.obligations = true;
  }
  return ran;
}

/**
 * PURE: bucket resolution status from (path ran?, row count, path failed?).
 *
 * `failed` only changes the story where we would otherwise have claimed a CONFIDENT
 * ZERO. That is the whole point: an empty bucket must never be reported as "none
 * found" when the truth is "we could not look". It never suppresses rows we did
 * find — a partial answer is still an answer, and hiding it would trade one
 * dishonesty for another.
 */
export function bucketResolution(
  ran: boolean,
  count: number,
  failed = false
): AffectedResolution {
  if (count > 0) return "resolved";
  if (failed) return "resolver_error";
  return ran ? "none_found" : "not_applicable";
}

/** PURE: merge two affected sets, de-duplicating by (type, id). */
export function mergeAffected(a: AffectedBuckets, b: AffectedBuckets): AffectedBuckets {
  const dedup = (xs: FindingAffectedEntity[]): FindingAffectedEntity[] => {
    const seen = new Set<string>();
    const out: FindingAffectedEntity[] = [];
    for (const x of xs) {
      const k = `${x.type}:${x.id}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(x);
      }
    }
    return out;
  };
  return {
    vendors: dedup([...a.vendors, ...b.vendors]),
    ai_systems: dedup([...a.ai_systems, ...b.ai_systems]),
    controls: dedup([...a.controls, ...b.controls]),
    obligations: dedup([...a.obligations, ...b.obligations]),
  };
}

/**
 * Resolve the affected entities for an assessment-family finding by walking the
 * finding's `source_id` to its assessment record and the entity that record is about.
 * Org-scoped on every predicate (org comes from the caller, never request input).
 * Returns empty buckets for intelligence/manual sources (nothing to resolve here).
 */
export async function resolveAssessmentAffected(
  client: Queryable,
  organizationId: string,
  sourceType: string,
  sourceId: string | null
): Promise<AffectedBuckets> {
  const out = EMPTY_AFFECTED();
  if (!sourceId) return out;

  // 1. Simple single-entity assessment families (vendor / control / AI / obligation).
  const spec = ASSESSMENT_AFFECTED_MAP[sourceType];
  if (spec) {
    const r = await client.query(
      `SELECT e.id AS id, e.${spec.nameCol} AS name
         FROM ${spec.assessmentTable} a
         JOIN ${spec.entityTable} e ON e.id = a.${spec.entityFk} AND e.organization_id = a.organization_id
        WHERE a.id = $1 AND a.organization_id = $2`,
      [sourceId, organizationId]
    );
    for (const x of r.rows) out[BUCKET_OF[spec.type]].push({ type: spec.type, id: x.id, name: x.name });
    return out;
  }

  // 2. dependency_review → the dependency's vendor (when the dependency has one).
  if (sourceType === "dependency_review") {
    const r = await client.query(
      `SELECT v.id AS id, v.name AS name
         FROM dependency_assessments da
         JOIN dependencies d ON d.id = da.dependency_id AND d.organization_id = da.organization_id
         JOIN vendors v ON v.id = d.vendor_id AND v.organization_id = d.organization_id
        WHERE da.id = $1 AND da.organization_id = $2`,
      [sourceId, organizationId]
    );
    for (const x of r.rows) out.vendors.push({ type: "vendor", id: x.id, name: x.name });
    return out;
  }

  // 3. risk → the controls and obligations linked to the risk (soft-delete aware).
  if (sourceType === "risk") {
    const [c, o] = await Promise.all([
      client.query(
        `SELECT c.id AS id, c.name AS name
           FROM risk_control_links l
           JOIN controls c ON c.id = l.control_id AND c.organization_id = l.organization_id
          WHERE l.organization_id = $1 AND l.risk_id = $2 AND l.deleted_at IS NULL
          ORDER BY c.name`,
        [organizationId, sourceId]
      ),
      client.query(
        `SELECT o.id AS id, o.title AS name
           FROM risk_obligation_links l
           JOIN obligations o ON o.id = l.obligation_id AND o.organization_id = l.organization_id
          WHERE l.organization_id = $1 AND l.risk_id = $2 AND l.deleted_at IS NULL
          ORDER BY o.title`,
        [organizationId, sourceId]
      ),
    ]);
    for (const x of c.rows) out.controls.push({ type: "control", id: x.id, name: x.name });
    for (const x of o.rows) out.obligations.push({ type: "obligation", id: x.id, name: x.name });
    return out;
  }

  // 4. applicability_assessment → the affected entities the applicability decision reached.
  if (sourceType === "applicability_assessment") {
    const r = await client.query(
      `SELECT DISTINCT via_target_type AS ttype, via_target_id AS tid
         FROM applicability_affected_entities
        WHERE organization_id = $1 AND assessment_id = $2`,
      [organizationId, sourceId]
    );
    const idsByType = new Map<AffectedEntityType, string[]>();
    for (const x of r.rows) {
      const t = x.ttype as AffectedEntityType;
      if (!BUCKET_OF[t]) continue;
      idsByType.set(t, [...(idsByType.get(t) ?? []), x.tid]);
    }
    await Promise.all(
      Array.from(idsByType.entries()).map(async ([type, ids]) => {
        const src = ENTITY_NAME_SOURCE[type];
        const rows = (
          await client.query(
            `SELECT id, ${src.nameCol} AS name FROM ${src.table}
              WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY ${src.nameCol}`,
            [organizationId, uniq(ids)]
          )
        ).rows;
        for (const x of rows) out[BUCKET_OF[type]].push({ type, id: x.id, name: x.name });
      })
    );
    return out;
  }

  return out;
}

/**
 * PURE: turn a finding activity row into a human "what's changed" label. Kept
 * separate so it is unit-testable without a database.
 */
export function describeChange(eventType: string, payload: unknown): string {
  const p = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  switch (eventType) {
    case "finding.created":
      return "Finding created";
    case "finding.updated": {
      if (p["severity"]) return `Severity changed to ${String(p["severity"])}`;
      if (p["status"]) return `Status changed to ${String(p["status"])}`;
      if (p["owner_user_id"]) return "Owner reassigned";
      if (p["priority"]) return `Priority changed to ${String(p["priority"])}`;
      if (p["due_date"]) return "SLA / due date changed";
      return "Finding updated";
    }
    default:
      return eventType.replace(/^finding\./, "").replace(/[._]/g, " ");
  }
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0)));
}

/**
 * Resolve the full Decision Workspace context for a finding. Returns null when the
 * finding does not exist in the caller's org (the route maps that to 404).
 */
export async function resolveFindingContext(
  client: Queryable,
  organizationId: string,
  findingId: string,
  opts: { since?: string | null } = {}
): Promise<FindingContext | null> {
  const f = await client.query(
    `SELECT id, source_type, source_id, owner_user_id, severity, priority, confidence, decision_state, operational_status
       FROM findings
      WHERE id = $1 AND organization_id = $2`,
    [findingId, organizationId]
  );
  if ((f.rowCount ?? 0) === 0) return null;
  const finding = f.rows[0];

  // Deterministic, explainable risk score (Phase 3.1) from the finding's own fields.
  const risk = computeFindingRiskScore({
    severity: finding.severity ?? null,
    priority: finding.priority ?? null,
    confidence: finding.confidence ?? null,
  });

  // Expand intelligence references across the signal↔event bridge.
  const refs = directIntelRefs(finding.source_type, finding.source_id);
  let signalIds = refs.signalIds;
  let eventIds = refs.eventIds;
  // applicability_assessment findings point at an applicability decision, which is
  // ABOUT a signal — bridge to it so the workspace surfaces the supporting intelligence.
  if (finding.source_type === "applicability_assessment" && finding.source_id) {
    const a = await client.query(
      `SELECT signal_id FROM applicability_assessments WHERE id = $1 AND organization_id = $2`,
      [finding.source_id, organizationId]
    );
    signalIds = uniq([...signalIds, ...a.rows.map((x) => x.signal_id)]);
  }
  if (signalIds.length > 0) {
    const r = await client.query(
      `SELECT DISTINCT event_id FROM intelligence_event_sources WHERE cyber_signal_id = ANY($1::uuid[])`,
      [signalIds]
    );
    eventIds = uniq([...eventIds, ...r.rows.map((x) => x.event_id)]);
  }
  if (refs.eventIds.length > 0) {
    const r = await client.query(
      `SELECT DISTINCT cyber_signal_id FROM intelligence_event_sources
         WHERE event_id = ANY($1::uuid[]) AND cyber_signal_id IS NOT NULL`,
      [refs.eventIds]
    );
    signalIds = uniq([...signalIds, ...r.rows.map((x) => x.cyber_signal_id)]);
  }

  // Affected entities via org-scoped signal_*_links (soft-delete aware).
  async function affected(
    table: string,
    fk: string,
    entityTable: string,
    nameCol: string,
    type: AffectedEntityType
  ): Promise<FindingAffectedEntity[]> {
    if (signalIds.length === 0) return [];
    const r = await client.query(
      `SELECT e.id AS id, e.${nameCol} AS name
         FROM ${table} l
         JOIN ${entityTable} e ON e.id = l.${fk} AND e.organization_id = l.organization_id
        WHERE l.organization_id = $1
          AND l.signal_id = ANY($2::uuid[])
          AND l.deleted_at IS NULL
        ORDER BY e.${nameCol}`,
      [organizationId, signalIds]
    );
    return r.rows.map((x) => ({ type, id: x.id, name: x.name }));
  }

  // Which buckets could not be resolved. A resolution path that FAILS must degrade
  // that bucket to `resolver_error` — not throw. Throwing 500'd the whole context
  // route, and the client turns a non-OK response into `null` and silently renders
  // the legacy detail view, so the failure reached the user as a MISSING FEATURE
  // rather than as an error. Failing soft, per bucket, is what makes the four-state
  // empty-state contract reachable at all.
  const failed = { vendors: false, ai_systems: false, controls: false, obligations: false };

  async function affectedSafe(
    bucket: keyof typeof failed,
    table: string,
    fk: string,
    entityTable: string,
    nameCol: string,
    type: AffectedEntityType
  ): Promise<FindingAffectedEntity[]> {
    try {
      return await affected(table, fk, entityTable, nameCol, type);
    } catch (err) {
      failed[bucket] = true;
      logger.error(
        { event: "finding_context_bucket_failed", organizationId, findingId, bucket, err },
        "Affected-entity bucket failed to resolve — reporting resolver_error, not a zero"
      );
      return [];
    }
  }

  const [sv, sa, sc, so] = await Promise.all([
    affectedSafe("vendors", "signal_vendor_links", "vendor_id", "vendors", "name", "vendor"),
    affectedSafe("ai_systems", "signal_ai_system_links", "ai_system_id", "ai_systems", "name", "ai_system"),
    affectedSafe("controls", "signal_control_links", "control_id", "controls", "name", "control"),
    affectedSafe("obligations", "signal_obligation_links", "obligation_id", "obligations", "title", "obligation"),
  ]);

  // Event-native vendor resolution (Context Contract): an event-sourced finding
  // EXISTS because the org tracks the event's affected_vendor (the relevance
  // gate in eventFindingStore.isRelevantToOrg) — so resolve that same canonical
  // match at read time. Same lower(trim(name)) equality; org-scoped; composes
  // existing canonical data (never stored on the finding). Without this branch
  // a Microsoft-linked event finding rendered "No affected vendors" unless a
  // human had already accepted a signal-link suggestion.
  let eventVendors: FindingAffectedEntity[] = [];
  if (eventIds.length) {
    try {
      const r = await client.query(
        `SELECT DISTINCT v.id AS id, v.name AS name
           FROM intelligence_events e
           JOIN vendors v
             ON v.organization_id = $1
            AND lower(trim(v.name)) = lower(trim(e.affected_vendor))
          WHERE e.id = ANY($2::uuid[]) AND e.affected_vendor IS NOT NULL
          ORDER BY v.name`,
        [organizationId, eventIds]
      );
      eventVendors = r.rows.map((x) => ({ type: "vendor" as const, id: x.id, name: x.name }));
    } catch (err) {
      failed.vendors = true;
      logger.error(
        { event: "finding_context_bucket_failed", organizationId, findingId, bucket: "vendors", err },
        "Event-native vendor resolution failed — reporting resolver_error, not a zero"
      );
    }
  }

  // Intelligence findings resolve affected entities from signal links; assessment /
  // risk / applicability findings resolve them from their source record. A finding has
  // one source_type, so only one path yields rows — merge (dedup) is safe either way.
  //
  // A failure here means we could not source ANY bucket from this finding's source
  // record, so every bucket it would have populated is unknown — not zero.
  let assessmentAffected: AffectedBuckets = {
    vendors: [],
    ai_systems: [],
    controls: [],
    obligations: [],
  };
  try {
    assessmentAffected = await resolveAssessmentAffected(
      client,
      organizationId,
      finding.source_type,
      finding.source_id
    );
  } catch (err) {
    failed.vendors = failed.ai_systems = failed.controls = failed.obligations = true;
    logger.error(
      { event: "finding_context_source_failed", organizationId, findingId, sourceType: finding.source_type, err },
      "Source-record affected resolution failed — every bucket reports resolver_error, not a zero"
    );
  }
  const { vendors, ai_systems, controls, obligations } = mergeAffected(
    mergeAffected(
      { vendors: sv, ai_systems: sa, controls: sc, obligations: so },
      { vendors: eventVendors, ai_systems: [], controls: [], obligations: [] }
    ),
    assessmentAffected
  );

  // Per-bucket resolution status: which paths ran vs. what they found — the UI
  // can now distinguish an honest zero from "not resolvable from this source".
  const ran = affectedPathsRan(finding.source_type, signalIds.length > 0, eventIds.length > 0);
  const resolution: AffectedResolutions = {
    vendors: bucketResolution(ran.vendors, vendors.length, failed.vendors),
    ai_systems: bucketResolution(ran.ai_systems, ai_systems.length, failed.ai_systems),
    controls: bucketResolution(ran.controls, controls.length, failed.controls),
    obligations: bucketResolution(ran.obligations, obligations.length, failed.obligations),
  };

  // Matcher suggestions pending human review (candidate links). Shown as
  // needs_review candidates — NEVER merged into the affected buckets, so
  // ambiguity is displayed as ambiguity (IQP / R2). Org-scoped; name resolved
  // from the canonical entity table for the suggestion's target type.
  const candidateRows =
    signalIds.length > 0 || eventIds.length > 0
      ? (
          await client.query(
            `SELECT s.target_type, s.target_id, s.match_reason, s.match_score,
                    COALESCE(v.name, a.name, c.name, o.title) AS name
               FROM signal_match_suggestions s
               LEFT JOIN vendors v     ON s.target_type = 'vendor'     AND v.id = s.target_id AND v.organization_id = s.organization_id
               LEFT JOIN ai_systems a  ON s.target_type = 'ai_system'  AND a.id = s.target_id AND a.organization_id = s.organization_id
               LEFT JOIN controls c    ON s.target_type = 'control'    AND c.id = s.target_id AND c.organization_id = s.organization_id
               LEFT JOIN obligations o ON s.target_type = 'obligation' AND o.id = s.target_id AND o.organization_id = s.organization_id
              WHERE s.organization_id = $1
                AND (s.signal_id = ANY($2::uuid[]) OR s.intelligence_event_id = ANY($3::uuid[]))
                AND s.accepted_at IS NULL AND s.dismissed_at IS NULL
              ORDER BY s.match_score DESC NULLS LAST, s.created_at DESC
              LIMIT 20`,
            [organizationId, signalIds, eventIds]
          )
        ).rows
      : [];
  const alreadyAffected = new Set(
    [...vendors, ...ai_systems, ...controls, ...obligations].map((e) => `${e.type}:${e.id}`)
  );
  const candidates: FindingCandidateEntity[] = candidateRows
    .filter((s) => s.name != null && !alreadyAffected.has(`${s.target_type}:${s.target_id}`))
    .map((s) => ({
      type: s.target_type as AffectedEntityType,
      id: s.target_id,
      name: s.name,
      status: "needs_review" as const,
      match_reason: s.match_reason ?? null,
      match_score: s.match_score == null ? null : Number(s.match_score),
    }));

  // Business-impact assessment (Phase 3.1) from the affected-entity mix +
  // severity band, honest about unsourceable dimensions (Context Contract).
  const business_impact = assessBusinessImpact(
    {
      vendors: vendors.length,
      ai_systems: ai_systems.length,
      controls: controls.length,
      obligations: obligations.length,
    },
    risk.band,
    resolution
  );

  // Supporting Intelligence Events (GLOBAL) + their sources + timeline.
  const events = eventIds.length
    ? (
        await client.query(
          `SELECT id, canonical_key, title, event_type, severity, status,
                  ever_exploited, ever_patched, affected_cve, affected_vendor,
                  source_count, confidence, first_seen_at, last_seen_at
             FROM intelligence_events
            WHERE id = ANY($1::uuid[])`,
          [eventIds]
        )
      ).rows
    : [];
  const sources = eventIds.length
    ? (
        await client.query(
          `SELECT event_id, source, external_id, relation, confidence, last_contributed_at
             FROM intelligence_event_sources
            WHERE event_id = ANY($1::uuid[])
            ORDER BY last_contributed_at DESC`,
          [eventIds]
        )
      ).rows
    : [];
  const timeline = eventIds.length
    ? (
        await client.query(
          `SELECT event_id, entry_type, occurred_at, summary, source
             FROM intelligence_event_timeline
            WHERE event_id = ANY($1::uuid[])
            ORDER BY occurred_at DESC
            LIMIT 50`,
          [eventIds]
        )
      ).rows
    : [];

  // Evidence attached directly to the finding (evidence.source_type='finding').
  const evidence = (
    await client.query(
      `SELECT id, title, description, evidence_type, collected_at, collected_by, external_ref, created_at
         FROM evidence
        WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2
        ORDER BY created_at DESC`,
      [organizationId, findingId]
    )
  ).rows;

  /**
   * RELATED FINDINGS — highest-confidence shared operational context, in
   * deterministic tier order (ratified relationship hierarchy).
   *
   *   Tier 1  Same Intelligence      same CVE / advisory / intelligence event
   *   Tier 2  Same Technical Target  same product / version / component   [SEE BELOW]
   *   Tier 3  Same Enterprise Context same control / obligation / AI system / asset
   *   Tier 4  Same Operational Context same assessment / same owner
   *   Tier 5  Same Vendor            SUPPORTING CONTEXT ONLY — never a list
   *
   * A finding can qualify at several tiers; it is reported at its BEST (lowest)
   * one, so the strongest true relationship is the one the customer sees.
   *
   * WHAT THIS REPLACES: `source_id = $3 AND source_type = $4` — a self-select for
   * findings on the IDENTICAL source row. That is co-location, not relatedness, and
   * it was structurally broken for the entire event channel: a partial unique index
   * (idx_findings_intelligence_event_unique) permits at most ONE finding per
   * (org, event), so an event-sourced finding could never have a related finding.
   * A guaranteed zero. The old rule survives, correctly demoted to Tier 4
   * ("same assessment") — two findings off one control test ARE related, just not
   * as strongly as two findings about the same CVE.
   *
   * TIER 5 IS NOT IN THIS LIST, BY DESIGN. Vendor is supporting context and must
   * never become the organizing principle of the workflow. A Microsoft CVE in an
   * org with 1000+ Microsoft findings would otherwise return 1000 rows of unrelated
   * vulnerabilities — the same uselessness as zero, wearing a different hat. Same-
   * vendor is returned separately as a COUNT (`related_context.same_vendor`), which
   * the UI renders as one navigational line, not a list. The customer is guided
   * toward the affected assets and the operational work, not toward the vendor.
   *
   * TIER 2 IS A DELIBERATE, DOCUMENTED HOLE. It cannot be sourced today: findings
   * carry no product linkage of any kind, and canonical_products is dark (no live
   * writer). Faking it with vendor identity is precisely what canonicalProduct.ts
   * forbids — "vendor identity ALONE is not a product identity". R4 fills this seam;
   * until then the hierarchy honestly skips from 1 to 3 rather than inventing a rung.
   */
  const selfControlIds = controls.map((c) => c.id);
  const selfObligationIds = obligations.map((o) => o.id);
  const selfAiSystemIds = ai_systems.map((a) => a.id);
  const selfVendorIds = vendors.map((v) => v.id);

  const related_findings = (
    await client.query(
      `
      WITH self_cve AS (
        SELECT c.affected_cve AS cve FROM cyber_signals c
         WHERE c.id = ANY($3::uuid[]) AND c.affected_cve IS NOT NULL
        UNION
        SELECT e.affected_cve FROM intelligence_events e
         WHERE e.id = ANY($4::uuid[]) AND e.affected_cve IS NOT NULL
      ),
      -- Every signal/event about the same vulnerability, plus this finding's own.
      -- cyber_signals is not org-filtered (signals may be global, organization_id
      -- NULL); tenant safety comes from findings.organization_id on every arm below.
      kin_signals AS (
        SELECT c.id FROM cyber_signals c WHERE c.affected_cve IN (SELECT cve FROM self_cve)
        UNION SELECT unnest($3::uuid[])
      ),
      kin_events AS (
        SELECT e.id FROM intelligence_events e WHERE e.affected_cve IN (SELECT cve FROM self_cve)
        UNION SELECT unnest($4::uuid[])
      ),
      -- Tier 3: signals touching the same enterprise entities this finding touches.
      ctx_signals AS (
        SELECT l.signal_id FROM signal_control_links l
          WHERE l.organization_id = $1 AND l.control_id = ANY($7::uuid[]) AND l.deleted_at IS NULL
        UNION
        SELECT l.signal_id FROM signal_obligation_links l
          WHERE l.organization_id = $1 AND l.obligation_id = ANY($8::uuid[]) AND l.deleted_at IS NULL
        UNION
        SELECT l.signal_id FROM signal_ai_system_links l
          WHERE l.organization_id = $1 AND l.ai_system_id = ANY($9::uuid[]) AND l.deleted_at IS NULL
      ),
      ctx_control_assessments AS (
        SELECT id FROM control_assessments
         WHERE organization_id = $1 AND control_id = ANY($7::uuid[])
      ),
      ctx_obligation_assessments AS (
        SELECT id FROM obligation_assessments
         WHERE organization_id = $1 AND obligation_id = ANY($8::uuid[])
      ),
      ctx_ai_reviews AS (
        SELECT id FROM governance_reviews
         WHERE organization_id = $1 AND ai_system_id = ANY($9::uuid[])
      ),
      candidates AS (
        -- TIER 1 — same intelligence (same CVE, advisory, or event; both channels)
        SELECT f.id, 1 AS tier, 'same_intelligence'::text AS relation
          FROM findings f
         WHERE f.organization_id = $1 AND f.id <> $2
           AND (
             (f.source_type IN ('cyber_signal','signal') AND f.source_id IN (SELECT id FROM kin_signals))
             OR (f.source_type = 'intelligence_event' AND f.source_id IN (SELECT id FROM kin_events))
           )

        UNION ALL
        -- TIER 3 — same enterprise context (control / obligation / AI system)
        SELECT f.id, 3, 'same_enterprise_context'
          FROM findings f
         WHERE f.organization_id = $1 AND f.id <> $2
           AND (
             (f.source_type IN ('cyber_signal','signal') AND f.source_id IN (SELECT signal_id FROM ctx_signals))
             OR (f.source_type = 'control_test'      AND f.source_id IN (SELECT id FROM ctx_control_assessments))
             OR (f.source_type = 'obligation_review' AND f.source_id IN (SELECT id FROM ctx_obligation_assessments))
             OR (f.source_type = 'ai_review'         AND f.source_id IN (SELECT id FROM ctx_ai_reviews))
           )

        UNION ALL
        -- TIER 4 — same operational context: the same assessment record
        SELECT f.id, 4, 'same_assessment'
          FROM findings f
         WHERE f.organization_id = $1 AND f.id <> $2
           AND $5::uuid IS NOT NULL AND f.source_id = $5::uuid AND f.source_type = $6

        UNION ALL
        -- TIER 4 — same operational context: the same person is doing the work
        SELECT f.id, 4, 'same_owner'
          FROM findings f
         WHERE f.organization_id = $1 AND f.id <> $2
           AND $10::uuid IS NOT NULL AND f.owner_user_id = $10::uuid
           AND ${sqlFindingActive("f.operational_status")}
      ),
      best AS (SELECT id, MIN(tier) AS tier FROM candidates GROUP BY id),
      ranked AS (
        SELECT f.id, f.title, f.severity, f.status,
               b.tier AS relation_tier,
               (SELECT c.relation FROM candidates c
                 WHERE c.id = b.id AND c.tier = b.tier LIMIT 1) AS relation,
               CASE f.severity
                 WHEN 'Critical' THEN 0 WHEN 'High' THEN 1
                 WHEN 'Moderate' THEN 2 ELSE 3 END AS sev_rank,
               f.created_at
          FROM best b
          JOIN findings f ON f.id = b.id
      ),
      capped AS (
        SELECT r.*,
               ROW_NUMBER() OVER (
                 PARTITION BY r.relation ORDER BY r.sev_rank, r.created_at DESC
               ) AS rn
          FROM ranked r
      )
      SELECT id, title, severity, status, relation_tier, relation
        FROM capped
       -- 'same_owner' is the WEAKEST relation in the hierarchy and the one most
       -- prone to degenerating into noise: a small team means one person owns most
       -- open work, so unbounded it asserts that everything is related to
       -- everything. Capped at 2 so it can inform but never dominate — the same
       -- down-rank-and-cap discipline applied to vendor at Tier 5. "All of my open
       -- work" is a real question, but it is My Work's question, not this panel's.
       WHERE NOT (relation = 'same_owner' AND rn > 2)
       ORDER BY relation_tier ASC, sev_rank ASC, created_at DESC
       LIMIT 10
      `,
      [
        organizationId,
        findingId,
        signalIds,
        eventIds,
        finding.source_id,
        finding.source_type,
        selfControlIds,
        selfObligationIds,
        selfAiSystemIds,
        finding.owner_user_id,
      ]
    )
  ).rows;

  /**
   * TIER 5 — same vendor. A COUNT, never a list.
   *
   * Rendered as a single navigational line ("142 other findings affect Microsoft →")
   * pointing at the vendor page. That keeps the vendor as supporting context and
   * keeps the Decision Workspace pointed at the assets and the work.
   */
  const same_vendor =
    selfVendorIds.length > 0
      ? (
          await client.query(
            `
            SELECT v.id AS vendor_id, v.name AS vendor_name, COUNT(DISTINCT f.id)::int AS finding_count
              FROM vendors v
              JOIN findings f ON f.organization_id = $1 AND f.id <> $2
               AND (
                 f.source_id IN (
                   SELECT l.signal_id FROM signal_vendor_links l
                    WHERE l.organization_id = $1 AND l.vendor_id = v.id AND l.deleted_at IS NULL
                 ) AND f.source_type IN ('cyber_signal','signal')
                 OR
                 f.source_id IN (
                   SELECT a.id FROM vendor_assessments a
                    WHERE a.organization_id = $1 AND a.vendor_id = v.id
                 ) AND f.source_type = 'vendor_review'
               )
             WHERE v.organization_id = $1 AND v.id = ANY($3::uuid[])
             GROUP BY v.id, v.name
             HAVING COUNT(DISTINCT f.id) > 0
             ORDER BY COUNT(DISTINCT f.id) DESC
            `,
            [organizationId, findingId, selfVendorIds]
          )
        ).rows
      : [];

  /**
   * C4 part 3 (D2-A) — the enterprise context this decision sits in. Composed at READ
   * from the org profile and the existing graph blast radius. Writes nothing; adds no
   * canonical data. Rooted at the finding's already-resolved affected entities, so it
   * inherits their org scoping and does not re-resolve anything.
   */
  const enterprise_context = await resolveFindingEnterpriseContext(client, organizationId, {
    vendors,
    ai_systems,
  });

  // Owner (org-scoped defensive lookup).
  const owner = finding.owner_user_id
    ? (
        await client.query(`SELECT id, email FROM users WHERE id = $1 AND organization_id = $2`, [
          finding.owner_user_id,
          organizationId,
        ])
      ).rows[0] ?? null
    : null;

  // Activity from the org-scoped security audit log: the finding's own events
  // PLUS its remediation actions' events (action.created / action.updated /
  // action.status_changed carry status, owner and due-date changes — the
  // reassignment history the walkthrough asked for). Action events were
  // audit-logged all along (actions.ts writeAuditEvent) but never fetched, so
  // reassignments surfaced nowhere.
  const activityRows = (
    await client.query(
      `SELECT event_type, resource_type, resource_id, payload, created_at
         FROM security_audit_log
        WHERE organization_id = $1
          AND (
            (resource_type = 'finding' AND resource_id = $2)
            OR (resource_type = 'action' AND resource_id IN (
              SELECT id FROM actions
               WHERE organization_id = $1
                 AND source_type = 'finding'
                 AND source_id = $2
            ))
          )
        ORDER BY created_at DESC
        LIMIT 50`,
      [organizationId, findingId]
    )
  ).rows;

  // What's changed since the marker (opts.since). When no marker, empty (the UI
  // shows "No changes" / first review). Per-user markers land in a later phase.
  const since = opts.since ?? null;
  const changes = since
    ? activityRows
        .filter((a) => new Date(a.created_at).getTime() > new Date(since).getTime())
        .map((a) => ({ label: describeChange(a.event_type, a.payload), at: String(a.created_at) }))
    : [];

  return {
    finding: {
      id: finding.id,
      source_type: finding.source_type,
      source_id: finding.source_id,
      decision_state: finding.decision_state,
      operational_status: finding.operational_status,
    },
    risk,
    business_impact,
    owner,
    affected: { vendors, ai_systems, controls, obligations, resolution, candidates },
    intelligence: { events, sources, timeline, signal_ids: signalIds },
    evidence,
    related_findings,
    related_context: { same_vendor },
    enterprise_context,
    activity: activityRows,
    whats_changed: { since, changes },
  };
}
