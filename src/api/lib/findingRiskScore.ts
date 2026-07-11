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
 *   - Business impact reports ONLY the dimensions we can source (third-party,
 *     regulatory, operational), derived from the affected-entity counts. The two
 *     we could not source — revenue and customer — used to be shipped as permanent
 *     `not_assessed` placeholders. They are now removed outright: a dimension we
 *     have no data for earns no row. Marking it "not_assessed" forever is not
 *     honesty, it is clutter that trains the reader to ignore the panel.
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

/**
 * The business-impact dimensions we can HONESTLY source.
 *
 * `revenue` and `customer` were removed. They were hardcoded literals —
 * `{ level: "not_assessed", note: "No revenue-impact signal available" }` —
 * returned unconditionally, ignoring every input. They stayed "Not assessed" on a
 * finding scoring 100/Critical with all four affected buckets resolved, because
 * no code path could ever set them to anything else, and no revenue or
 * customer-impact column exists anywhere in the schema to source them from.
 *
 * A panel row that can only ever say "Not assessed" is not a measurement, it is
 * furniture. It taught users to read the whole panel as decorative. Removed
 * rather than faked.
 *
 * They come back when there is something real behind them. graphImpactAnalysis.ts
 * already computes a criticality-weighted `business_impact_score` and
 * `blast_radius` over the asset graph and is consumed only by the knowledge-graph
 * route — wiring that in is the honest way to restore a business-impact reading.
 */
export interface BusinessImpact {
  operational: BusinessImpactDimension;
  regulatory: BusinessImpactDimension;
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

  // EMPTY-STATE COPY (Q1): an empty dimension must say WHAT WAS CHECKED, so the
  // reader can tell "we looked and found nothing" from "we couldn't look".
  //
  // Deliberately NOT worded as "no vendor has a recorded dependency on the
  // affected product". That describes a product-level dependency check the
  // platform does not perform today — the vendor bucket resolves by matching the
  // signal's affected_vendor against vendor NAMES in the org's inventory (plus an
  // assessment-record walk). Claiming a dependency check we never ran would be a
  // more precise-sounding lie than the vague copy it replaces. The wording moves
  // to dependency language when R4 makes it true.
  return {
    third_party: dim(
      counts.vendors,
      resolution ? [resolution.vendors] : [],
      `${counts.vendors} affected vendor(s)`,
      "No vendor in your inventory matches this finding",
      "Vendor impact not resolvable from this finding's source"
    ),
    regulatory: dim(
      counts.obligations,
      resolution ? [resolution.obligations] : [],
      `${counts.obligations} affected obligation(s)`,
      "No obligation in your register is linked to this finding",
      "Regulatory impact not resolvable from this finding's source"
    ),
    operational: dim(
      opCount,
      resolution ? [resolution.controls, resolution.ai_systems] : [],
      `${counts.controls} control(s), ${counts.ai_systems} AI system(s) affected`,
      "No control or AI system in your inventory is linked to this finding",
      "Operational impact not resolvable from this finding's source"
    ),
  };
}
