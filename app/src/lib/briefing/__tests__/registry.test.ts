/**
 * Registry contract tests (Briefing Initiative B1).
 *
 * The registry is the canonical module catalog — pure serializable data with a
 * ratified legacy-tile projection. These tests are the contract: unique stable
 * ids, explicit scope on every module, personal modules honest about identity,
 * destinations that are real app hrefs, and a TOTAL legacy mapping (every one
 * of the 12 persisted tile ids resolves to a module or an explicit null).
 */
import { describe, it, expect } from "vitest";
import {
  BRIEFING_MODULE_IDS,
  LEGACY_DASHBOARD_TILE_IDS,
} from "../contracts";
import {
  BRIEFING_MODULES,
  briefingModule,
  legacyTileToModule,
} from "../registry";

describe("briefing module registry — contract", () => {
  it("every declared id has exactly one definition, in the canonical id list", () => {
    const ids = BRIEFING_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...BRIEFING_MODULE_IDS].sort());
  });

  it("registry data is pure and serializable — no component/function references", () => {
    // The render map lives in TheBriefing.tsx; the registry must survive a JSON
    // round-trip unchanged so a future engine-side manifest can be GENERATED
    // from it (the knowledge-index pattern), not hand-copied.
    expect(JSON.parse(JSON.stringify(BRIEFING_MODULES))).toEqual(BRIEFING_MODULES);
  });

  it("every module declares an explicit scope and an app-internal destination", () => {
    for (const m of BRIEFING_MODULES) {
      expect(["personal", "organization"]).toContain(m.scope);
      expect(m.destination.startsWith("/")).toBe(true);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it("personal modules require a user identity; org modules don't — except the personal-clock delta", () => {
    // whats_changed (EG2 slice 10) is the ratified exception: ORGANIZATION
    // numbers diffed against the SESSION USER's previous login. The scope chip
    // says whose numbers; the identity requirement exists because an API-key
    // session has no last-visit clock to diff against (module hides, honestly).
    const ORG_SCOPED_IDENTITY_EXCEPTIONS = new Set(["whats_changed"]);
    for (const m of BRIEFING_MODULES) {
      if (m.scope === "personal") {
        expect(m.requiresUserIdentity).toBe(true);
        expect(m.zone).toBe("your_work");
      } else if (ORG_SCOPED_IDENTITY_EXCEPTIONS.has(m.id)) {
        expect(m.requiresUserIdentity).toBe(true);
      } else {
        expect(m.requiresUserIdentity).toBe(false);
      }
    }
  });

  it("legacyTileId values are real legacy tile ids", () => {
    for (const m of BRIEFING_MODULES) {
      if (m.legacyTileId !== null) {
        expect(LEGACY_DASHBOARD_TILE_IDS).toContain(m.legacyTileId);
      }
    }
  });

  it("briefingModule() resolves every id and throws on garbage", () => {
    for (const id of BRIEFING_MODULE_IDS) {
      expect(briefingModule(id).id).toBe(id);
    }
    expect(() => briefingModule("nope" as never)).toThrow(/unknown briefing module/);
  });
});

describe("legacyTileToModule — the B2 preference-migration key", () => {
  it("is TOTAL over the 12 legacy tile ids and lands on real modules", () => {
    for (const tile of LEGACY_DASHBOARD_TILE_IDS) {
      const mapped = legacyTileToModule(tile);
      if (mapped !== null) {
        expect(BRIEFING_MODULE_IDS).toContain(mapped);
      }
    }
  });

  it("pins the ratified projection (a silent remap would corrupt B2 migrations)", () => {
    expect(legacyTileToModule("posture_score")).toBe("posture_score");
    expect(legacyTileToModule("findings_donut")).toBe("needs_attention");
    expect(legacyTileToModule("actions_ring")).toBe("overdue_actions");
    // Analytical tiles have no Briefing counterpart — their home is /posture.
    for (const tile of [
      "risks_breakdown",
      "risk_heatmap",
      "posture_trend",
      "domain_posture",
      "open_items_aging",
      "vendor_risk",
      "framework_gaps",
      "compliance_coverage",
      "inventory_grid",
    ] as const) {
      expect(legacyTileToModule(tile)).toBeNull();
    }
  });

  it("the mapped-to modules carry the reverse pointer (legacyTileId round-trip)", () => {
    for (const tile of LEGACY_DASHBOARD_TILE_IDS) {
      const mapped = legacyTileToModule(tile);
      if (mapped !== null) {
        expect(briefingModule(mapped).legacyTileId).toBe(tile);
      }
    }
  });
});
