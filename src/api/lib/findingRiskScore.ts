/**
 * findingRiskScore.ts — ERIP Package 3 (Decision Workspace), Phase 3.1.
 *
 * PURE, deterministic, explainable composition of a finding's risk score and its
 * business-impact assessment from data that already exists (severity, priority,
 * confidence, and the affected-entity mix resolved in Phase 3.0). No I/O.
 *
 * Honesty rules (ERIP-AD-20 — never fabricate):
 *   - The risk score is a bounded, reproducible function of real inputs, and it
 *     carries a rationale trace.
 *   - Business-impact dimensions we cannot source (revenue, customer) are marked
 *     `not_assessed`, never invented. Dimensions we CAN source (third-party,
 *     regulatory, operational) are derived from the affected-entity counts.
 */

export type ImpactLevel = "high" | "medium" | "low" | "none" | "not_assessed";

export interface FindingRiskInputs {
  severity: string | null;
  priority: string | null;
  confidence: number | null;
}

export interface FindingRiskScore {
  score: number; // 0–100
  band: "Critical" | "High" | "Moderate" | "Low";
  rationale: string[];
}

const SEVERITY_BASE: Record<string, number> = {
  critical: 90,
  high: 70,
  moderate: 45,
  medium: 45,
  low: 20,
};

const PRIORITY_ADJ: Record<string, number> = {
  immediate: 10,
  near_term: 4,
  planned: 0,
  watch: -10,
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function bandFor(score: number): FindingRiskScore["band"] {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 35) return "Moderate";
  return "Low";
}

/**
 * Deterministic finding risk score. Severity dominates; priority nudges urgency;
 * low confidence discounts. Every input that moves the number is traced.
 */
export function computeFindingRiskScore(input: FindingRiskInputs): FindingRiskScore {
  const rationale: string[] = [];
  const sevKey = (input.severity ?? "").toLowerCase();
  const base = SEVERITY_BASE[sevKey] ?? 40;
  rationale.push(
    input.severity && SEVERITY_BASE[sevKey] !== undefined
      ? `Severity ${input.severity} → base ${base}`
      : `Unknown/absent severity → base ${base}`
  );

  const prKey = (input.priority ?? "").toLowerCase();
  const prAdj = PRIORITY_ADJ[prKey] ?? 0;
  if (prAdj !== 0) rationale.push(`Priority ${input.priority} → ${prAdj > 0 ? "+" : ""}${prAdj}`);

  // Confidence (0–100) discounts a low-confidence finding by up to 15 points.
  let confAdj = 0;
  if (typeof input.confidence === "number" && !Number.isNaN(input.confidence)) {
    confAdj = Math.round(((input.confidence - 100) / 100) * 15); // 100→0, 0→-15
    if (confAdj !== 0) rationale.push(`Confidence ${input.confidence} → ${confAdj}`);
  }

  const score = clamp(base + prAdj + confAdj);
  return { score, band: bandFor(score), rationale };
}

export interface AffectedCounts {
  vendors: number;
  ai_systems: number;
  controls: number;
  obligations: number;
}

/**
 * Per-bucket resolution outcome from the context resolver (Context Contract):
 *   resolved        — an applicable path ran and found ≥1 entity
 *   none_found      — an applicable path ran and honestly found nothing
 *   not_applicable  — NO resolution path exists for this finding's source type
 *                     (empty ≠ zero: the dimension simply cannot be sourced)
 */
export type AffectedResolution = "resolved" | "none_found" | "not_applicable";

export interface AffectedResolutions {
  vendors: AffectedResolution;
  ai_systems: AffectedResolution;
  controls: AffectedResolution;
  obligations: AffectedResolution;
}

export interface BusinessImpactDimension {
  level: ImpactLevel;
  note: string;
}

export interface BusinessImpact {
  revenue: BusinessImpactDimension;
  operational: BusinessImpactDimension;
  regulatory: BusinessImpactDimension;
  customer: BusinessImpactDimension;
  third_party: BusinessImpactDimension;
}

/**
 * Scale an affected-count into an impact level, weighted by severity band. Zero
 * affected → 'none'. Used for the dimensions we can honestly source.
 */
function levelFrom(count: number, band: FindingRiskScore["band"]): ImpactLevel {
  if (count <= 0) return "none";
  const high = band === "Critical" || band === "High";
  if (count >= 3) return high ? "high" : "medium";
  return high ? "medium" : "low";
}

/**
 * Business-impact assessment. Third-party / regulatory / operational are derived
 * from the affected-entity mix + severity band. Revenue and customer are
 * `not_assessed` — we hold no data for them and will not fabricate one.
 *
 * Context Contract honesty rule: a sourceable dimension is `none` ONLY when its
 * bucket honestly resolved to zero (`none_found`). When no resolution path
 * exists for this finding's source (`not_applicable`), the dimension is
 * `not_assessed` — the UI must never assert "No affected vendors" about a
 * dimension the resolver could not source. Omitting `resolution` preserves the
 * legacy count-only behaviour.
 */
export function assessBusinessImpact(
  counts: AffectedCounts,
  band: FindingRiskScore["band"],
  resolution?: AffectedResolutions
): BusinessImpact {
  const opCount = counts.controls + counts.ai_systems;

  const dim = (
    count: number,
    buckets: AffectedResolution[],
    positive: string,
    zero: string,
    unsourced: string
  ): BusinessImpactDimension => {
    if (count > 0) return { level: levelFrom(count, band), note: positive };
    // Zero: honest only if at least one contributing bucket actually ran.
    const anyRan = resolution === undefined || buckets.some((b) => b !== "not_applicable");
    return anyRan
      ? { level: "none", note: zero }
      : { level: "not_assessed", note: unsourced };
  };

  return {
    third_party: dim(
      counts.vendors,
      resolution ? [resolution.vendors] : [],
      `${counts.vendors} affected vendor(s)`,
      "No affected vendors",
      "Vendor impact not resolvable from this finding's source"
    ),
    regulatory: dim(
      counts.obligations,
      resolution ? [resolution.obligations] : [],
      `${counts.obligations} affected obligation(s)`,
      "No affected obligations",
      "Regulatory impact not resolvable from this finding's source"
    ),
    operational: dim(
      opCount,
      resolution ? [resolution.controls, resolution.ai_systems] : [],
      `${counts.controls} control(s), ${counts.ai_systems} AI system(s) affected`,
      "No affected controls or AI systems",
      "Operational impact not resolvable from this finding's source"
    ),
    revenue: { level: "not_assessed", note: "No revenue-impact signal available" },
    customer: { level: "not_assessed", note: "No customer-impact signal available" },
  };
}
