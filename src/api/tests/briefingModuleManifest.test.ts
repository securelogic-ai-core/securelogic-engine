/**
 * Briefing module manifest — drift + contract checks (B1 hardening).
 *
 * The committed engine-side manifest must equal a fresh rebuild from the
 * canonical app registry (the Application Knowledge Index pattern). This is
 * the B2 hard precondition: any future write path that accepts module ids
 * validates against THIS manifest, so it can never drift from the app registry
 * and the registry is never a client-trusted catalog.
 */
import { describe, it, expect } from "vitest";

import { BRIEFING_MODULES } from "../../../app/src/lib/briefing/registry.js";
import { LEGACY_DASHBOARD_TILE_IDS } from "../../../app/src/lib/briefing/contracts.js";
import { BRIEFING_MODULE_MANIFEST } from "../lib/briefingModuleManifest.generated.js";
import {
  briefingManifestModule,
  briefingManifestModuleIds,
  isKnownBriefingModuleId,
  type BriefingModuleManifest,
} from "../lib/briefingModuleManifest.js";

// Rebuild exactly as scripts/generate-briefing-module-manifest.ts does.
const rebuilt: BriefingModuleManifest = {
  schema_version: 1,
  modules: JSON.parse(JSON.stringify(BRIEFING_MODULES)),
  legacy_tile_ids: [...LEGACY_DASHBOARD_TILE_IDS],
};

describe("Briefing module manifest — committed artifact is not stale", () => {
  it("equals a fresh rebuild from the app registry (run `npm run generate:briefing-manifest` if this fails)", () => {
    expect(rebuilt).toEqual(BRIEFING_MODULE_MANIFEST);
  });

  it("carries every registry module and all 12 legacy tile ids", () => {
    expect(BRIEFING_MODULE_MANIFEST.modules.length).toBe(BRIEFING_MODULES.length);
    expect(BRIEFING_MODULE_MANIFEST.legacy_tile_ids.length).toBe(12);
  });
});

describe("Briefing module manifest — validation contract", () => {
  it("module ids are unique and resolvable", () => {
    const ids = BRIEFING_MODULE_MANIFEST.modules.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isKnownBriefingModuleId(BRIEFING_MODULE_MANIFEST, id)).toBe(true);
      expect(briefingManifestModule(BRIEFING_MODULE_MANIFEST, id)?.id).toBe(id);
    }
  });

  it("rejects unknown ids — the future write path's first line of defense", () => {
    expect(isKnownBriefingModuleId(BRIEFING_MODULE_MANIFEST, "made_up")).toBe(false);
    expect(isKnownBriefingModuleId(BRIEFING_MODULE_MANIFEST, "")).toBe(false);
    // A LEGACY tile id is NOT a briefing module id — the B2 migration maps
    // them explicitly; the validator must not conflate the vocabularies.
    expect(isKnownBriefingModuleId(BRIEFING_MODULE_MANIFEST, "inventory_grid")).toBe(false);
    expect(briefingManifestModule(BRIEFING_MODULE_MANIFEST, "made_up")).toBeNull();
  });

  it("authorization-relevant metadata is well-formed on every module", () => {
    for (const m of BRIEFING_MODULE_MANIFEST.modules) {
      expect(["personal", "organization"]).toContain(m.scope);
      expect(["platform", "all"]).toContain(m.minEntitlement);
      expect(["your_work", "organization", "intelligence"]).toContain(m.zone);
      expect(typeof m.requiresUserIdentity).toBe("boolean");
      if (m.scope === "personal") expect(m.requiresUserIdentity).toBe(true);
      if (m.legacyTileId !== null) {
        expect(BRIEFING_MODULE_MANIFEST.legacy_tile_ids).toContain(m.legacyTileId);
      }
    }
  });

  it("id sets are consistent across the helper surface", () => {
    const ids = briefingManifestModuleIds(BRIEFING_MODULE_MANIFEST);
    expect(ids.size).toBe(BRIEFING_MODULE_MANIFEST.modules.length);
  });
});
