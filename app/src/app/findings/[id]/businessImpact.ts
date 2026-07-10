/**
 * businessImpact.ts — pure derivation of the single headline Business-impact
 * level from the five per-dimension levels shown in the Decision Workspace
 * Zone C (revenue, operational, regulatory, customer, third-party).
 *
 * WHY THIS EXISTS (workflow-consistency Phase 2): the header chip previously
 * read `[third_party, regulatory, operational].find(high|medium) ?? "low"`,
 * which had two credibility bugs:
 *   1. it ignored revenue + customer entirely (3 of 5 dimensions), and
 *   2. it FLOORED the headline to "low" whenever nothing was high/medium — so a
 *      finding whose dimensions are all `none`/`not_assessed` displayed
 *      "Business impact: Low" while the rows beneath it honestly said
 *      "None" / "Not assessed". Header and detail contradicted each other.
 *
 * The headline must be a PURE FUNCTION of the exact rows rendered below it, so
 * the two can never disagree. This module is that function — dependency-free and
 * unit-tested (no React), the same pattern the rest of the app uses for
 * testable view logic.
 */

export type ImpactLevel = "high" | "medium" | "low" | "none" | "not_assessed";

const KNOWN_DESCENDING: ImpactLevel[] = ["high", "medium", "low"];

/** Normalize an unknown/legacy level string to a recognized ImpactLevel. */
function normalize(level: string): ImpactLevel {
  switch (level) {
    case "high":
    case "medium":
    case "low":
    case "none":
    case "not_assessed":
      return level;
    default:
      // An unrecognized value is treated as unknown, never as a real impact.
      return "not_assessed";
  }
}

/**
 * The honest headline across the supplied dimension levels:
 *   - if ANY dimension carries a KNOWN impact, return the highest present
 *     (high > medium > low) — a known impact always dominates unknowns;
 *   - else if ANY dimension is `not_assessed`, return `not_assessed` (we cannot
 *     claim an overall level while dimensions are still unknown);
 *   - else every dimension was assessed as `none` → return `none`.
 *
 * Never floors to "low", never overstates, and reflects unassessed honestly.
 */
export function topBusinessImpact(levels: string[]): ImpactLevel {
  const norm = levels.map(normalize);
  for (const k of KNOWN_DESCENDING) {
    if (norm.includes(k)) return k;
  }
  return norm.includes("not_assessed") ? "not_assessed" : "none";
}
