/**
 * briefingModuleManifest.ts — engine-side types + validation entry point for the
 * Briefing module manifest (Briefing Initiative, B1 hardening).
 *
 * The CANONICAL module registry lives in the app
 * (app/src/lib/briefing/registry.ts — pure serializable data). The engine's
 * committed manifest (briefingModuleManifest.generated.ts) is GENERATED from it
 * (`npm run generate:briefing-manifest`) and drift-tested
 * (src/api/tests/briefingModuleManifest.test.ts), following the Application
 * Knowledge Index pattern — never hand-copied. This kills the dual hand-synced
 * catalog anti-pattern the legacy dashboard tiles had (VALID_TILE_IDS ↔
 * TILE_LABELS).
 *
 * STATUS: INERT BY CONSTRUCTION. No route imports this module yet — B1 has no
 * Briefing write path. It exists so that the moment B2 introduces one (layout
 * persistence referencing module ids), the engine validates ids and
 * authorization-relevant metadata against ITS OWN committed manifest instead of
 * trusting the client — the B2 hard precondition ruled in the B1 architecture
 * review. Any B2 write route MUST validate ids via isKnownBriefingModuleId()
 * (and scope/flag metadata via briefingManifestModule()).
 */

export type BriefingManifestModule = {
  id: string;
  title: string;
  description: string;
  zone: "your_work" | "organization" | "intelligence";
  category: string;
  /** Whose numbers the module shows — rendered as an explicit chip in the app. */
  scope: "personal" | "organization";
  /** Personal modules require a session user identity (JWT); omitted otherwise. */
  requiresUserIdentity: boolean;
  /** Minimum display tier ("platform" = premium|platform|team). */
  minEntitlement: "platform" | "all";
  /** App feature flag the module depends on (fail-closed), when any. */
  requiredFlag?: string;
  /** Drill-down href that reproduces the module's headline number. */
  destination: string;
  /** Legacy dashboard_preferences tile this module supersedes (B2 migration key). */
  legacyTileId: string | null;
};

export type BriefingModuleManifest = {
  schema_version: 1;
  modules: BriefingManifestModule[];
  /** The 12 legacy tile ids persisted in dashboard_preferences.layout today. */
  legacy_tile_ids: string[];
};

/** Module ids as a set — the write-path validation primitive. */
export function briefingManifestModuleIds(
  manifest: BriefingModuleManifest,
): Set<string> {
  return new Set(manifest.modules.map((m) => m.id));
}

/** Whether a client-supplied module id exists in the committed manifest. */
export function isKnownBriefingModuleId(
  manifest: BriefingModuleManifest,
  id: string,
): boolean {
  return briefingManifestModuleIds(manifest).has(id);
}

/** Manifest lookup for a module's authorization-relevant metadata. */
export function briefingManifestModule(
  manifest: BriefingModuleManifest,
  id: string,
): BriefingManifestModule | null {
  return manifest.modules.find((m) => m.id === id) ?? null;
}
