/**
 * relationHierarchy.ts — the ratified Related-Findings relationship hierarchy,
 * in one legible place.
 *
 * Two findings are related by their HIGHEST-CONFIDENCE shared operational context.
 * A finding may qualify at several tiers; it is shown at its best (lowest) one.
 *
 *   Tier 1  Same Intelligence        same CVE / advisory / intelligence event
 *   Tier 2  Same Technical Target    same product / version / component      [NOT YET SOURCEABLE]
 *   Tier 3  Same Enterprise Context  same asset / application / AI system / control / obligation
 *   Tier 4  Same Operational Context same assessment / same owner
 *   Tier 5  Same Vendor              SUPPORTING CONTEXT ONLY — a count, never a list
 *
 * TIER 5 IS NOT IN THE LIST. Vendor must never become the organizing principle of
 * the workflow. Same-vendor findings are summarised as a count that links to the
 * vendor page, so the Decision Workspace keeps pointing at the affected assets and
 * the operational work rather than at the supplier.
 *
 * TIER 2 IS AN HONEST HOLE. Findings carry no product linkage today and
 * canonical_products has no live writer, so there is nothing to join on. Inferring
 * a product from a vendor name is exactly what canonicalProduct.ts forbids —
 * "vendor identity ALONE is not a product identity". R4 fills this seam; until then
 * the hierarchy skips 1 → 3 rather than inventing a rung it cannot support.
 */

export const RELATION_TIER = {
  SAME_INTELLIGENCE: 1,
  SAME_TECHNICAL_TARGET: 2,
  SAME_ENTERPRISE_CONTEXT: 3,
  SAME_OPERATIONAL_CONTEXT: 4,
  SAME_VENDOR: 5,
} as const;

/** Customer-facing reason a finding appears. Says WHAT is shared, not which table. */
export const RELATION_LABEL: Record<string, string> = {
  same_intelligence: "Same vulnerability",
  same_enterprise_context: "Affects the same control, AI system or obligation",
  same_assessment: "Raised by the same assessment",
  same_owner: "Assigned to the same owner",
};

/** The tier a relation belongs to — the ordering the backend already applies. */
export const RELATION_TIER_OF: Record<string, number> = {
  same_intelligence: RELATION_TIER.SAME_INTELLIGENCE,
  same_enterprise_context: RELATION_TIER.SAME_ENTERPRISE_CONTEXT,
  same_assessment: RELATION_TIER.SAME_OPERATIONAL_CONTEXT,
  same_owner: RELATION_TIER.SAME_OPERATIONAL_CONTEXT,
};

/**
 * Relations that must never be presented as an unbounded list, because they are
 * shared by too many findings to be evidence of "the same problem". Vendor is
 * capped to a count entirely; same-owner is capped to a couple of rows server-side.
 * Both would otherwise degenerate into "everything is related to everything".
 */
export const DOWN_RANKED_RELATIONS = new Set(["same_owner"]);
