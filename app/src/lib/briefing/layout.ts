/**
 * layout.ts — role-aware defaults, layout-envelope helpers, the legacy
 * dashboard-preferences projection, and deterministic module suggestions
 * (Briefing Initiative B2). Pure and fetch-free, like the rest of this lib.
 *
 * Role defaults are CODE, not rows: computed at request time on every render
 * for users with no saved layout, so default improvements reach non-customizers
 * automatically and a role change re-seeds the starting experience. Roles
 * influence the initial experience — they never permanently define it, and
 * nothing here is an authorization boundary (enforcement stays engine-side;
 * unknown/legacy role strings fall back to the canonical composition).
 */

import {
  BRIEFING_LAYOUT_VERSION,
  type BriefingLayoutEnvelope,
  type BriefingModuleId,
} from "./contracts";
import { BRIEFING_MODULES, legacyTileToModule } from "./registry";
import type { LegacyDashboardTileId } from "./contracts";

/** The known role vocabulary (users.role by convention — no persona model). */
export type BriefingRole = "admin" | "analyst" | "viewer";

export function normalizeBriefingRole(
  role: string | null | undefined,
): BriefingRole | null {
  return role === "admin" || role === "analyst" || role === "viewer"
    ? role
    : null; // legacy 'member', unknown strings, API-key sessions
}

/** Canonical composition = the registry's own (zone) order — the B1 default. */
export const CANONICAL_MODULE_ORDER: readonly BriefingModuleId[] =
  BRIEFING_MODULES.map((m) => m.id);

/**
 * The role-aware default composition. Deterministic; documented in the B2 spec.
 * - admin: the canonical composition (personal work → org picture → intelligence).
 * - analyst: work-first — triage emphasis (recent findings before the posture score).
 * - viewer: read-only consumer — the org picture and intelligence only. Since
 *   viewers cannot persist a layout (platform-wide viewer-mutation block), this
 *   default IS the viewer experience.
 * - unknown/legacy roles: canonical (safe fallback, never an error).
 */
export function defaultBriefingModulesForRole(
  role: string | null | undefined,
): BriefingModuleId[] {
  switch (normalizeBriefingRole(role)) {
    case "analyst":
      return [
        "my_work",
        "my_pending_reviews",
        "needs_attention",
        "overdue_actions",
        "ready_to_close",
        "recent_findings",
        "posture_score",
        "latest_brief",
      ];
    case "viewer":
      return ["posture_score", "needs_attention", "recent_findings", "latest_brief"];
    case "admin":
    default:
      return [...CANONICAL_MODULE_ORDER];
  }
}

/** Build the persisted envelope from an ordered id list (single-instance B2). */
export function envelopeFromModuleIds(
  ids: readonly BriefingModuleId[],
): BriefingLayoutEnvelope {
  return {
    version: BRIEFING_LAYOUT_VERSION,
    modules: ids.map((moduleId) => ({ moduleId, instanceKey: moduleId, config: {} })),
  };
}

/**
 * Tolerant client-side parse of a stored envelope into an ordered id list.
 * Returns null when the payload is not a v1 envelope (the caller falls back to
 * the unsaved state). Unknown ids survive here — filterRequestedModules drops
 * them against the registry, which is the actual enforcement point.
 */
export function moduleIdsFromEnvelope(raw: unknown): string[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const env = raw as { version?: unknown; modules?: unknown };
  if (env.version !== BRIEFING_LAYOUT_VERSION) return null;
  if (!Array.isArray(env.modules)) return null;
  const ids: string[] = [];
  for (const entry of env.modules) {
    const moduleId = (entry as { moduleId?: unknown } | null)?.moduleId;
    if (typeof moduleId !== "string") return null;
    ids.push(moduleId);
  }
  return ids;
}

// ── Legacy dashboard_preferences projection (the B2 migration path) ──────────

/** The legacy {id, visible, order} tile entry persisted by dashboard_preferences. */
export type LegacyTileEntry = { id: string; visible: boolean; order: number };

export type LegacyProjection = {
  /** The seeded, ordered module ids to render (unsaved until the user saves). */
  seededIds: BriefingModuleId[];
  /** Superseded modules hidden because their legacy tile was hidden. */
  hiddenByLegacy: BriefingModuleId[];
  /** Visible legacy tiles with NO Briefing counterpart — disclosed, never silent. */
  droppedTiles: string[];
};

/**
 * Project a saved legacy tile layout onto the Briefing (the ratified
 * legacyTileToModule mapping — B2's one-time migration key, applied lazily at
 * read time and persisted only by an explicit user save; spec ruling C2/C5).
 *
 * Semantics: the ROLE default provides the base order (a flat tile list has no
 * meaningful projection onto the sectioned composition — the B1 ruling);
 * legacy tile VISIBILITY is honored for superseded modules (a hidden
 * findings_donut hides needs_attention); superseded modules whose tile was
 * visible but which the role default omits are APPENDED in canonical order
 * (the user had chosen to see them); visible tiles with no counterpart are
 * returned for the disclosure banner.
 */
export function projectLegacyPreferences(
  legacy: readonly LegacyTileEntry[],
  roleDefaultIds: readonly BriefingModuleId[],
): LegacyProjection {
  const byTile = new Map(legacy.map((t) => [t.id, t]));

  const hiddenByLegacy: BriefingModuleId[] = [];
  const visibleSuperseded = new Set<BriefingModuleId>();
  for (const def of BRIEFING_MODULES) {
    if (!def.legacyTileId) continue;
    const tile = byTile.get(def.legacyTileId);
    if (!tile) continue;
    if (tile.visible) visibleSuperseded.add(def.id);
    else hiddenByLegacy.push(def.id);
  }

  const droppedTiles = legacy
    .filter(
      (t) =>
        t.visible &&
        legacyTileToModule(t.id as LegacyDashboardTileId) === null,
    )
    .map((t) => t.id);

  const seededIds = roleDefaultIds.filter(
    (id) => !hiddenByLegacy.includes(id),
  );
  for (const id of CANONICAL_MODULE_ORDER) {
    if (visibleSuperseded.has(id) && !seededIds.includes(id)) seededIds.push(id);
  }

  return { seededIds, hiddenByLegacy, droppedTiles };
}

// ── Deterministic module suggestions (no AI; customize panel only) ───────────

export type BriefingSuggestion = {
  moduleId: BriefingModuleId;
  /** Human-readable, deterministic reason — shown next to the module in the panel. */
  reason: string;
};

/**
 * Suggest eligible modules missing from the current layout, from observable
 * state only: live personal counts first, then role-default membership (which
 * also surfaces newly shipped default modules to existing customizers). Pure
 * function of its inputs; suggestions are dismissible and NEVER auto-applied.
 */
export function suggestBriefingModules(args: {
  currentIds: readonly string[];
  eligibleIds: readonly BriefingModuleId[];
  roleDefaultIds: readonly BriefingModuleId[];
  /** vm.myPendingReviews?.mine — null when unknown (never suggest on unknown). */
  pendingReviewsMine: number | null;
}): BriefingSuggestion[] {
  const current = new Set(args.currentIds);
  const out: BriefingSuggestion[] = [];
  for (const id of args.eligibleIds) {
    if (current.has(id)) continue;
    if (id === "my_pending_reviews" && (args.pendingReviewsMine ?? 0) > 0) {
      out.push({
        moduleId: id,
        reason: `${args.pendingReviewsMine} finding${args.pendingReviewsMine === 1 ? "" : "s"} awaiting your review decision`,
      });
      continue;
    }
    if (args.roleDefaultIds.includes(id)) {
      out.push({ moduleId: id, reason: "Part of your role's default Briefing" });
    }
  }
  return out;
}
