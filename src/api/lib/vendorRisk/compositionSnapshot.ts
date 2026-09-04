/**
 * compositionSnapshot.ts — the customer-readable, immutable record of WHAT
 * SecureLogic composed for an engagement and WHY (Assessment Composition v1).
 *
 * ── What it answers ──────────────────────────────────────────────────────────
 * Before issuing, the customer can see: which Core Assurance objectives apply
 * and which do not (with the facts read); which applicable requirements are
 * already satisfied by governed evidence (with the evidence basis); which
 * additional requirements the relationship's facts, obligations and domains
 * added and under which domain; the depth each item is asked at; how the
 * tier's nominal target was met; and whether the honest result is that no
 * formal questionnaire is required at all.
 *
 * ── Built, not derived ───────────────────────────────────────────────────────
 * The snapshot is assembled from the resolver's output at resolve time and
 * written by value. Requirement titles, framework names, fact values and
 * evidence bases are copied in, never referenced, so a later edit to any of
 * them cannot change what the customer was shown. `snapshot_hash` is the
 * sha256 of the canonical JSON WITHOUT `resolved_at`, so re-resolving the same
 * engagement from the same inputs yields the same hash — the reproducibility
 * test asserts exactly that.
 *
 * ── What it deliberately does not carry ──────────────────────────────────────
 * Raw scores, weights and rule internals. Rule ids and customer-facing
 * rationales, yes; the arithmetic, no (goal §G: useful explainability, not
 * scoring machinery). Nothing about a person: fact values describe the
 * relationship in the aggregate.
 */

import { createHash } from "node:crypto";

import { canonicalJson } from "./applicabilityStore.js";
import type { AssessmentDomain } from "./requirementDomain.js";
import type { AssessmentTier } from "./riskBands.js";
import type { ScopableRequirement, ScopeDepth, ScopeItem, ScopeResolution } from "./scopeResolver.js";

export const COMPOSITION_SNAPSHOT_VERSION = "composition-snapshot-1.0" as const;

/** What the route knows about a requirement beyond the resolver's view. */
export type ComposableRequirement = ScopableRequirement & {
  description?: string | null;
  framework_name: string;
};

export type CompositionItemOutcome = "asked" | "evidence_satisfied";
export type CoreObjectiveOutcome = CompositionItemOutcome | "not_applicable" | "not_provisioned";

export type CompositionReason = { rule_id: string; rule_family: string; rationale: string };

export type CompositionCoreObjective = {
  reference: string;
  title: string;
  requirement_id: string | null;
  outcome: CoreObjectiveOutcome;
  depth: ScopeDepth | null;
  domain: AssessmentDomain | null;
  rule_id: string | null;
  /** Customer-facing: why it applies / does not apply. */
  rationale: string;
  /** The signals and fact values the applicability rule read. */
  basis: Record<string, unknown> | null;
  /** The S4 decision basis when governed evidence satisfied it. */
  evidence: Record<string, unknown> | null;
  /** Every rule that included it, for "why we are asking". */
  reasons: CompositionReason[];
};

export type CompositionAdditionalItem = {
  requirement_id: string;
  reference: string;
  title: string;
  framework: string;
  framework_key: string | null;
  domain: AssessmentDomain | null;
  depth: ScopeDepth;
  outcome: CompositionItemOutcome;
  evidence: Record<string, unknown> | null;
  reasons: CompositionReason[];
};

export type CompositionSnapshot = {
  snapshot_version: typeof COMPOSITION_SNAPSHOT_VERSION;
  scope_rule_version: string;
  tier: AssessmentTier;
  core_assurance_version: string | null;
  summary: {
    asked: number;
    asked_full: number;
    asked_confirm: number;
    asked_attest: number;
    evidence_satisfied: number;
    core_applicable: number;
    core_not_applicable: number;
    core_missing: number;
    additional_asked: number;
    excluded_by_rules: number;
    truncated: { cap: number; dropped: number } | null;
    nominal_target: number | null;
    mandatory_overage: number | null;
    /** True when nothing is asked and nothing is evidence-satisfied. */
    no_questionnaire_required: boolean;
  };
  domains: Array<{ domain: AssessmentDomain; asked: number; evidence_satisfied: number }>;
  core_assurance: {
    version: string;
    framework_key: string;
    objectives: CompositionCoreObjective[];
  } | null;
  additional: CompositionAdditionalItem[];
  dropped: Array<{ requirement_id: string; reference: string; title: string; framework: string }>;
  coverage: {
    computed: boolean;
    applied: boolean;
    version: string | null;
    as_of: string | null;
    covered_count: number;
    gap_count: number;
  };
  resolved_at: string;
};

export type CoverageSummary = CompositionSnapshot["coverage"];

function reasonsOf(item: ScopeItem): CompositionReason[] {
  return item.reasons.map((r) => ({ rule_id: r.rule_id, rule_family: r.rule_family, rationale: r.rationale }));
}

function evidenceOf(item: ScopeItem): Record<string, unknown> | null {
  const s4 = item.reasons.find((r) => r.rule_id === "S4.assurance");
  if (!s4) return null;
  return (s4.basis as Record<string, unknown> | undefined) ?? {};
}

function outcomeOf(item: ScopeItem): CompositionItemOutcome {
  return item.reasons.some((r) => r.rule_id === "S4.assurance") ? "evidence_satisfied" : "asked";
}

export function buildCompositionSnapshot(args: {
  resolution: ScopeResolution;
  requirements: readonly ComposableRequirement[];
  coverage: CoverageSummary;
  resolvedAt: string;
}): { snapshot: CompositionSnapshot; hash: string } {
  const { resolution } = args;
  const byId = new Map(args.requirements.map((r) => [r.requirement_id, r]));
  const itemById = new Map(resolution.items.map((i) => [i.requirement_id, i]));

  const core = resolution.core_assurance ?? null;
  const coreRequirementIds = new Set(core?.decisions.map((d) => d.requirement_id) ?? []);

  // ── Core Assurance objectives, in reference order ─────────────────────────
  let objectives: CompositionCoreObjective[] = [];
  if (core) {
    objectives = core.decisions.map((d) => {
      const req = byId.get(d.requirement_id);
      const item = itemById.get(d.requirement_id);
      const title = req?.title ?? d.reference;
      if (!d.applicable) {
        return {
          reference: d.reference,
          title,
          requirement_id: d.requirement_id,
          outcome: "not_applicable",
          depth: null,
          domain: null,
          rule_id: d.rule_id,
          rationale: d.rationale,
          basis: d.basis,
          evidence: null,
          reasons: [],
        };
      }
      // Applicable but not in the final items: only the tier cap could do
      // that, and the floor is never truncated — so this is an assertion of
      // the floor promise, recorded as "asked" with the reasons it carried.
      const evidence = item ? evidenceOf(item) : null;
      return {
        reference: d.reference,
        title,
        requirement_id: d.requirement_id,
        outcome: item ? outcomeOf(item) : "asked",
        depth: item?.depth ?? null,
        domain: item?.domain ?? null,
        rule_id: d.rule_id,
        rationale: d.rationale,
        basis: d.basis,
        evidence,
        reasons: item ? reasonsOf(item) : [],
      };
    });
    for (const ref of core.missing) {
      objectives.push({
        reference: ref,
        title: ref,
        requirement_id: null,
        outcome: "not_provisioned",
        depth: null,
        domain: null,
        rule_id: null,
        rationale: "This objective is not present in the requirement library, so it could not be assessed.",
        basis: null,
        evidence: null,
        reasons: [],
      });
    }
    objectives.sort((a, b) => a.reference.localeCompare(b.reference));
  }

  // ── Everything else that is asked ─────────────────────────────────────────
  const additional: CompositionAdditionalItem[] = resolution.items
    .filter((i) => !coreRequirementIds.has(i.requirement_id))
    .map((i) => {
      const req = byId.get(i.requirement_id);
      return {
        requirement_id: i.requirement_id,
        reference: req?.reference_id ?? i.requirement_id,
        title: req?.title ?? i.requirement_id,
        framework: req?.framework_name ?? "",
        framework_key: req?.framework_key ?? null,
        domain: i.domain ?? null,
        depth: i.depth,
        outcome: outcomeOf(i),
        evidence: evidenceOf(i),
        reasons: reasonsOf(i),
      };
    })
    .sort((a, b) => a.framework.localeCompare(b.framework) || a.reference.localeCompare(b.reference));

  const dropped = (resolution.truncated?.dropped_requirement_ids ?? []).map((id) => {
    const req = byId.get(id);
    return {
      requirement_id: id,
      reference: req?.reference_id ?? id,
      title: req?.title ?? id,
      framework: req?.framework_name ?? "",
    };
  });

  // ── Domain rollup ─────────────────────────────────────────────────────────
  const domainCounts = new Map<AssessmentDomain, { asked: number; evidence_satisfied: number }>();
  for (const item of resolution.items) {
    if (!item.domain) continue;
    const c = domainCounts.get(item.domain) ?? { asked: 0, evidence_satisfied: 0 };
    if (outcomeOf(item) === "evidence_satisfied") c.evidence_satisfied += 1;
    else c.asked += 1;
    domainCounts.set(item.domain, c);
  }
  const domains = [...domainCounts.entries()]
    .map(([domain, c]) => ({ domain, ...c }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  // ── Summary ───────────────────────────────────────────────────────────────
  const askedItems = resolution.items.filter((i) => outcomeOf(i) === "asked");
  const satisfied = resolution.items.length - askedItems.length;
  const summary: CompositionSnapshot["summary"] = {
    asked: askedItems.length,
    asked_full: askedItems.filter((i) => i.depth === "full").length,
    asked_confirm: askedItems.filter((i) => i.depth === "confirm").length,
    asked_attest: askedItems.filter((i) => i.depth === "attest").length,
    evidence_satisfied: satisfied,
    core_applicable: core ? core.decisions.filter((d) => d.applicable).length : 0,
    core_not_applicable: core ? core.decisions.filter((d) => !d.applicable).length : 0,
    core_missing: core ? core.missing.length : 0,
    additional_asked: additional.length,
    excluded_by_rules: resolution.excluded.length,
    truncated: resolution.truncated
      ? { cap: resolution.truncated.cap, dropped: resolution.truncated.dropped_requirement_ids.length }
      : null,
    nominal_target: resolution.composition?.nominal_target ?? null,
    mandatory_overage: resolution.composition?.mandatory_overage ?? null,
    no_questionnaire_required: resolution.items.length === 0,
  };

  const snapshot: CompositionSnapshot = {
    snapshot_version: COMPOSITION_SNAPSHOT_VERSION,
    scope_rule_version: resolution.scope_rule_version,
    tier: resolution.tier,
    core_assurance_version: core?.version ?? null,
    summary,
    domains,
    core_assurance: core
      ? { version: core.version, framework_key: core.framework_key, objectives }
      : null,
    additional,
    dropped,
    coverage: args.coverage,
    resolved_at: args.resolvedAt,
  };

  return { snapshot, hash: compositionSnapshotHash(snapshot) };
}

/** sha256 over the canonical JSON of the snapshot WITHOUT its timestamp. */
export function compositionSnapshotHash(snapshot: CompositionSnapshot): string {
  const { resolved_at: _resolvedAt, ...stable } = snapshot;
  return createHash("sha256").update(canonicalJson(stable), "utf8").digest("hex");
}

/** Minimal query surface, so this works on a pool or a transaction client. */
export type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

export async function recordCompositionSnapshot(
  db: Queryable,
  args: {
    organizationId: string;
    engagementId: string;
    snapshot: CompositionSnapshot;
    hash: string;
    createdByUserId: string | null;
  }
): Promise<{ id: string }> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO vendor_engagement_composition_snapshots
       (organization_id, engagement_id, snapshot_version, scope_rule_version,
        core_assurance_version, assessment_tier, snapshot, snapshot_hash,
        asked_count, evidence_satisfied_count, not_applicable_count,
        no_questionnaire_required, created_by_user_id, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      args.organizationId,
      args.engagementId,
      args.snapshot.snapshot_version,
      args.snapshot.scope_rule_version,
      args.snapshot.core_assurance_version,
      args.snapshot.tier,
      JSON.stringify(args.snapshot),
      args.hash,
      args.snapshot.summary.asked,
      args.snapshot.summary.evidence_satisfied,
      args.snapshot.summary.core_not_applicable,
      args.snapshot.summary.no_questionnaire_required,
      args.createdByUserId,
      args.snapshot.resolved_at,
    ]
  );
  return { id: res.rows[0]!.id };
}

export type CompositionSnapshotRow = {
  id: string;
  snapshot: CompositionSnapshot;
  snapshot_hash: string;
  snapshot_version: string;
  scope_rule_version: string;
  resolved_at: string;
};

export async function loadLatestCompositionSnapshot(
  db: Queryable,
  organizationId: string,
  engagementId: string
): Promise<{ latest: CompositionSnapshotRow | null; history_count: number }> {
  const res = await db.query<CompositionSnapshotRow & { history_count: string }>(
    `SELECT id, snapshot, snapshot_hash, snapshot_version, scope_rule_version, resolved_at,
            COUNT(*) OVER ()::text AS history_count
       FROM vendor_engagement_composition_snapshots
      WHERE organization_id = $1 AND engagement_id = $2
      ORDER BY resolved_at DESC, created_at DESC
      LIMIT 1`,
    [organizationId, engagementId]
  );
  const row = res.rows[0];
  if (!row) return { latest: null, history_count: 0 };
  const { history_count, ...latest } = row;
  return { latest, history_count: Number(history_count) };
}
