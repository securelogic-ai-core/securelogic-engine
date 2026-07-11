/**
 * Guards the ratified Related-Findings relationship hierarchy.
 *
 * The two failure modes this panel has, and both are the same failure:
 *   - relate by NOTHING (the old rule: identical source row) -> a structural zero
 *     for the whole event channel, because a partial unique index permits only one
 *     event-sourced finding per event. Guaranteed "None", forever.
 *   - relate by VENDOR -> 1000 rows of unrelated CVEs for any org with a big
 *     Microsoft footprint. The same uselessness, wearing a different hat.
 *
 * The hierarchy exists to sit between them: relate by the strongest thing actually
 * shared, and demote the things shared by everything.
 */
import { describe, it, expect } from "vitest";
import {
  RELATION_TIER,
  RELATION_LABEL,
  RELATION_TIER_OF,
  DOWN_RANKED_RELATIONS,
} from "../relationHierarchy";

describe("relationship hierarchy — tier order is the product contract", () => {
  it("ranks intelligence above enterprise context above operational context", () => {
    expect(RELATION_TIER.SAME_INTELLIGENCE).toBeLessThan(RELATION_TIER.SAME_ENTERPRISE_CONTEXT);
    expect(RELATION_TIER.SAME_ENTERPRISE_CONTEXT).toBeLessThan(
      RELATION_TIER.SAME_OPERATIONAL_CONTEXT
    );
  });

  it("puts vendor LAST — it is supporting context, never the organizing principle", () => {
    const others = [
      RELATION_TIER.SAME_INTELLIGENCE,
      RELATION_TIER.SAME_TECHNICAL_TARGET,
      RELATION_TIER.SAME_ENTERPRISE_CONTEXT,
      RELATION_TIER.SAME_OPERATIONAL_CONTEXT,
    ];
    for (const t of others) expect(RELATION_TIER.SAME_VENDOR).toBeGreaterThan(t);
  });

  it("reserves tier 2 for technical target — the seam R4 fills, not a rung we invent", () => {
    // Tier 2 exists in the hierarchy but is NOT sourceable today: findings carry no
    // product linkage and canonical_products has no live writer. It must keep its
    // slot so the ordering stays stable when R4 wires it — and so nobody quietly
    // renumbers vendor into it.
    expect(RELATION_TIER.SAME_TECHNICAL_TARGET).toBe(2);
    expect(Object.values(RELATION_TIER_OF)).not.toContain(RELATION_TIER.SAME_TECHNICAL_TARGET);
  });
});

describe("relations the backend can actually emit", () => {
  it("every emitted relation maps to a tier AND to customer-facing copy", () => {
    // These four strings are what findingContextResolver's `relation` column emits.
    for (const relation of ["same_intelligence", "same_enterprise_context", "same_assessment", "same_owner"]) {
      expect(RELATION_TIER_OF[relation]).toBeDefined();
      expect(RELATION_LABEL[relation]).toBeTruthy();
    }
  });

  it("never emits a vendor relation into the list — vendor is a count, not a row", () => {
    expect(RELATION_TIER_OF["same_vendor"]).toBeUndefined();
    expect(RELATION_LABEL["same_vendor"]).toBeUndefined();
  });

  it("says WHAT is shared, in the customer's language — not a table name", () => {
    expect(RELATION_LABEL["same_intelligence"]).toBe("Same vulnerability");
    for (const copy of Object.values(RELATION_LABEL)) {
      expect(copy).not.toMatch(/signal_|_links|source_id|cyber_signals/);
    }
  });
});

describe("down-ranking — the guard against 'everything is related to everything'", () => {
  it("same_owner is down-ranked: one analyst owning the backlog is not a relationship", () => {
    expect(DOWN_RANKED_RELATIONS.has("same_owner")).toBe(true);
  });

  it("same_intelligence is NEVER down-ranked — it is the strongest evidence there is", () => {
    expect(DOWN_RANKED_RELATIONS.has("same_intelligence")).toBe(false);
    expect(DOWN_RANKED_RELATIONS.has("same_enterprise_context")).toBe(false);
  });
});
