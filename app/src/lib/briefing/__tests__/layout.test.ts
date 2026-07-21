/**
 * layout.test.ts — B2 role defaults, envelope helpers, legacy projection, and
 * deterministic suggestions. Everything here is pure; determinism is the
 * contract (same inputs → same layout, always — roles influence the initial
 * experience, they never permanently define it).
 */

import { describe, it, expect } from "vitest";
import {
  CANONICAL_MODULE_ORDER,
  defaultBriefingModulesForRole,
  envelopeFromModuleIds,
  moduleIdsFromEnvelope,
  normalizeBriefingRole,
  projectLegacyPreferences,
  suggestBriefingModules,
  type LegacyTileEntry,
} from "../layout";
import { BRIEFING_MODULE_IDS, LEGACY_DASHBOARD_TILE_IDS } from "../contracts";

const ALL_IDS = new Set<string>(BRIEFING_MODULE_IDS);

function legacyAllVisible(): LegacyTileEntry[] {
  return LEGACY_DASHBOARD_TILE_IDS.map((id, order) => ({ id, visible: true, order }));
}

describe("normalizeBriefingRole", () => {
  it("accepts exactly the known vocabulary", () => {
    expect(normalizeBriefingRole("admin")).toBe("admin");
    expect(normalizeBriefingRole("analyst")).toBe("analyst");
    expect(normalizeBriefingRole("viewer")).toBe("viewer");
  });
  it("nulls legacy 'member', unknown strings, and absent roles", () => {
    for (const bad of ["member", "ADMIN", "owner", "", null, undefined]) {
      expect(normalizeBriefingRole(bad)).toBeNull();
    }
  });
});

describe("defaultBriefingModulesForRole", () => {
  it("admin gets the canonical composition", () => {
    expect(defaultBriefingModulesForRole("admin")).toEqual([...CANONICAL_MODULE_ORDER]);
  });
  it("unknown / legacy / absent roles fall back to canonical (never an error)", () => {
    for (const role of ["member", "owner", null, undefined]) {
      expect(defaultBriefingModulesForRole(role)).toEqual([...CANONICAL_MODULE_ORDER]);
    }
  });
  it("analyst leads with work and triage (recent findings before posture score)", () => {
    const ids = defaultBriefingModulesForRole("analyst");
    expect(ids[0]).toBe("my_work");
    expect(ids.indexOf("recent_findings")).toBeLessThan(ids.indexOf("posture_score"));
  });
  it("viewer omits workflow modules (my_work, overdue_actions, ready_to_close)", () => {
    const ids = defaultBriefingModulesForRole("viewer");
    expect(ids).not.toContain("my_work");
    expect(ids).not.toContain("overdue_actions");
    expect(ids).not.toContain("ready_to_close");
    expect(ids).toContain("posture_score");
    expect(ids).toContain("latest_brief");
  });
  it("every role default references only registry ids, with no duplicates", () => {
    for (const role of ["admin", "analyst", "viewer", "member"]) {
      const ids = defaultBriefingModulesForRole(role);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(ALL_IDS.has(id)).toBe(true);
    }
  });
});

describe("layout envelope helpers", () => {
  it("round-trips an ordered id list through the envelope", () => {
    const ids = defaultBriefingModulesForRole("analyst");
    const env = envelopeFromModuleIds(ids);
    expect(env.version).toBe(1);
    expect(env.modules.every((m) => m.instanceKey === m.moduleId)).toBe(true);
    expect(env.modules.every((m) => Object.keys(m.config).length === 0)).toBe(true);
    expect(moduleIdsFromEnvelope(env)).toEqual(ids);
  });
  it("rejects non-envelope payloads (caller falls back to the unsaved state)", () => {
    expect(moduleIdsFromEnvelope(null)).toBeNull();
    expect(moduleIdsFromEnvelope([])).toBeNull();
    expect(moduleIdsFromEnvelope({ version: 2, modules: [] })).toBeNull();
    expect(moduleIdsFromEnvelope({ version: 1, modules: "x" })).toBeNull();
    expect(moduleIdsFromEnvelope({ version: 1, modules: [{ notModuleId: "x" }] })).toBeNull();
  });
  it("keeps unknown ids in the parse — eligibility filtering is the enforcement point", () => {
    const ids = moduleIdsFromEnvelope({
      version: 1,
      modules: [{ moduleId: "retired_module", instanceKey: "retired_module", config: {} }],
    });
    expect(ids).toEqual(["retired_module"]);
  });
});

describe("projectLegacyPreferences", () => {
  const adminDefault = defaultBriefingModulesForRole("admin");

  it("all-visible legacy layout: seeds the role default and discloses dropped analytical tiles", () => {
    const proj = projectLegacyPreferences(legacyAllVisible(), adminDefault);
    expect(proj.seededIds).toEqual(adminDefault);
    expect(proj.hiddenByLegacy).toEqual([]);
    // The 9 visible tiles with no Briefing counterpart — disclosed, never silent.
    expect(proj.droppedTiles).toEqual([
      "risks_breakdown",
      "risk_heatmap",
      "posture_trend",
      "domain_posture",
      "open_items_aging",
      "vendor_risk",
      "framework_gaps",
      "compliance_coverage",
      "inventory_grid",
    ]);
  });

  it("a hidden superseded tile hides its Briefing module", () => {
    const legacy = legacyAllVisible().map((t) =>
      t.id === "findings_donut" ? { ...t, visible: false } : t,
    );
    const proj = projectLegacyPreferences(legacy, adminDefault);
    expect(proj.hiddenByLegacy).toEqual(["needs_attention"]);
    expect(proj.seededIds).not.toContain("needs_attention");
    // A hidden analytical tile is not "dropped" — the user wasn't showing it.
    const hiddenAnalytical = legacyAllVisible().map((t) =>
      t.id === "risk_heatmap" ? { ...t, visible: false } : t,
    );
    expect(projectLegacyPreferences(hiddenAnalytical, adminDefault).droppedTiles).not.toContain(
      "risk_heatmap",
    );
  });

  it("appends visible superseded modules the role default omits (the user chose to see them)", () => {
    const viewerDefault = defaultBriefingModulesForRole("viewer");
    const proj = projectLegacyPreferences(legacyAllVisible(), viewerDefault);
    // actions_ring is visible → overdue_actions appended even though the viewer
    // default omits it.
    expect(proj.seededIds).toContain("overdue_actions");
    expect(proj.seededIds.slice(0, viewerDefault.length)).toEqual(viewerDefault);
  });

  it("is deterministic for identical inputs", () => {
    const a = projectLegacyPreferences(legacyAllVisible(), adminDefault);
    const b = projectLegacyPreferences(legacyAllVisible(), adminDefault);
    expect(a).toEqual(b);
  });
});

describe("suggestBriefingModules", () => {
  const roleDefaultIds = defaultBriefingModulesForRole("admin");

  it("suggests pending reviews on a known non-zero count, with the count in the reason", () => {
    const out = suggestBriefingModules({
      currentIds: ["my_work"],
      eligibleIds: ["my_work", "my_pending_reviews"],
      roleDefaultIds,
      pendingReviewsMine: 3,
    });
    const s = out.find((x) => x.moduleId === "my_pending_reviews");
    expect(s?.reason).toContain("3");
  });

  it("never suggests on an UNKNOWN count (honest-null discipline)", () => {
    const out = suggestBriefingModules({
      currentIds: [],
      eligibleIds: ["my_pending_reviews"],
      roleDefaultIds: [],
      pendingReviewsMine: null,
    });
    expect(out).toEqual([]);
  });

  it("suggests role-default modules missing from the layout, and nothing already shown", () => {
    const out = suggestBriefingModules({
      currentIds: roleDefaultIds.filter((id) => id !== "posture_score"),
      eligibleIds: roleDefaultIds,
      roleDefaultIds,
      pendingReviewsMine: 0,
    });
    expect(out.map((s) => s.moduleId)).toEqual(["posture_score"]);
  });

  it("suggests nothing when the layout already holds every eligible module", () => {
    const out = suggestBriefingModules({
      currentIds: roleDefaultIds,
      eligibleIds: roleDefaultIds,
      roleDefaultIds,
      pendingReviewsMine: 5,
    });
    expect(out).toEqual([]);
  });
});
