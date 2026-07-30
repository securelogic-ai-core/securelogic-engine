/**
 * registry.ts — the canonical Briefing module registry (Briefing Initiative, B1).
 *
 * Single source of truth for which modules exist, what they mean, whose numbers
 * they show, and where they drill down to. This registry is the successor to the
 * dual legacy tile catalog (engine VALID_TILE_IDS ↔ app TILE_LABELS, hand-synced
 * plus a render switch); when B2 introduces layout persistence the engine-side
 * validation manifest must be GENERATED from this file (drift-tested, like the
 * Application Knowledge Index) — never hand-copied.
 *
 * Pure serializable data only — see contracts.ts for the contract and the
 * authorization-boundary note. Render components live in the render map
 * (app/src/app/dashboard/briefing/TheBriefing.tsx).
 *
 * Deliberately EXCLUDED from The Briefing (classification, B1):
 *   - Account / Billing cards — navigational chrome; they live in the user menu
 *     (/account) and answered no "what matters now" question.
 *   - inventory_grid — inventory counts, not attention; lives on /posture and
 *     the per-object pages.
 *   - risks_breakdown / risk_heatmap / posture_trend / domain_posture /
 *     vendor_risk / framework_gaps / compliance_coverage / open_items_aging —
 *     analytical dashboard tiles; their home is the /posture dashboard (and
 *     /frameworks), which the Briefing links to. Dashboards remain valuable;
 *     the opening screen does not reproduce them.
 */

import type {
  BriefingModuleDef,
  BriefingModuleId,
  LegacyDashboardTileId,
} from "./contracts";

export const BRIEFING_MODULES: readonly BriefingModuleDef[] = [
  // ── Zone 1: Your work (personal, assignment-driven) ────────────────────────
  {
    // EG2 slice 10 (Operational Presence): the delta since the session user's
    // previous login — worse / needs-a-decision / better / new intelligence.
    // Leads the canonical composition: the first question a returning user has
    // is "what changed?", not "what is the standing state?". Personal FRAMING
    // (your last visit) over ORGANIZATION numbers — the scope chip says whose
    // numbers, the title says whose clock.
    id: "whats_changed",
    title: "Since Your Last Visit",
    description:
      "What changed while you were away — new findings, work that became overdue, remediation completed, findings closed, and new intelligence.",
    zone: "your_work",
    category: "my_work",
    scope: "organization",
    requiresUserIdentity: true,
    minEntitlement: "platform",
    destination: "/findings?queue=all",
    legacyTileId: null,
  },
  {
    id: "my_work",
    title: "My Work",
    description:
      "Findings you own and remediation actions assigned to you, with overdue work called out.",
    zone: "your_work",
    category: "my_work",
    scope: "personal",
    requiresUserIdentity: true,
    minEntitlement: "platform",
    // The My Work findings bucket — resolved server-side from the session
    // (owner=me contract); never a client-supplied user id.
    destination: "/findings?bucket=my_work",
    legacyTileId: null,
  },
  {
    id: "my_pending_reviews",
    title: "My Pending Reviews",
    description:
      "Findings assigned to you as independent Governance Reviewer — remediation complete, your closure decision pending.",
    zone: "your_work",
    category: "my_work",
    scope: "personal",
    requiresUserIdentity: true,
    minEntitlement: "platform",
    requiredFlag: "independent_review",
    destination: "/findings?bucket=pending_independent_review",
    legacyTileId: null,
  },

  // ── Zone 2: Across your organization (operational picture) ─────────────────
  {
    id: "needs_attention",
    title: "Needs Attention",
    description:
      "Critical and High active findings across the organization.",
    zone: "organization",
    category: "findings",
    scope: "organization",
    requiresUserIdentity: false,
    minEntitlement: "platform",
    destination: "/findings?active=true",
    legacyTileId: "findings_donut",
  },
  {
    id: "overdue_actions",
    title: "Remediation Actions",
    description:
      "Active remediation actions organization-wide, leading with overdue work.",
    zone: "organization",
    category: "actions",
    scope: "organization",
    requiresUserIdentity: false,
    minEntitlement: "platform",
    // view=team keeps the org-wide count honest when the Decision Workspace is
    // on (a bare /actions redirects to the caller's own queue) — orgActionsHref.
    destination: "/actions?active=true&view=team",
    legacyTileId: "actions_ring",
  },
  {
    id: "ready_to_close",
    title: "Ready to Close",
    description:
      "Organization-wide findings with remediation complete and a governance decision pending.",
    zone: "organization",
    category: "findings",
    scope: "organization",
    requiresUserIdentity: false,
    minEntitlement: "platform",
    destination: "/findings?bucket=ready_to_close",
    legacyTileId: null,
  },
  {
    id: "posture_score",
    title: "Security Posture",
    description:
      "The organization's latest posture score, linking to the full posture dashboard.",
    zone: "organization",
    category: "posture",
    scope: "organization",
    requiresUserIdentity: false,
    minEntitlement: "platform",
    destination: "/posture",
    legacyTileId: "posture_score",
  },
  {
    id: "recent_findings",
    title: "Recent Findings",
    description: "The five most recent active findings across the organization.",
    zone: "organization",
    category: "findings",
    scope: "organization",
    requiresUserIdentity: false,
    minEntitlement: "platform",
    destination: "/findings?queue=all",
    legacyTileId: null,
  },

  // ── Zone 3: Intelligence ───────────────────────────────────────────────────
  {
    id: "latest_brief",
    title: "Latest Brief",
    description: "The most recent Intelligence Brief for your organization.",
    zone: "intelligence",
    category: "intelligence",
    scope: "organization",
    requiresUserIdentity: false,
    minEntitlement: "all",
    destination: "/briefs",
    legacyTileId: null,
  },
] as const;

/** Registry lookup by id. */
export function briefingModule(id: BriefingModuleId): BriefingModuleDef {
  const def = BRIEFING_MODULES.find((m) => m.id === id);
  if (!def) throw new Error(`unknown briefing module: ${id}`);
  return def;
}

/**
 * legacyTileToModule — the pure legacy-tile → briefing-module projection.
 *
 * B2's preference-migration key: when the versioned Briefing layout persistence
 * lands, each saved dashboard_preferences tile maps through this function; a
 * null means the tile has no Briefing counterpart (its home is the /posture
 * dashboard) and the preference is dropped from the Briefing layout — visibly,
 * not silently (B2 owns the disclosure UX). NOTHING calls this at runtime in
 * B1; it exists (tested) so the mapping is a ratified contract, not a B2
 * improvisation.
 */
export function legacyTileToModule(
  tileId: LegacyDashboardTileId,
): BriefingModuleId | null {
  switch (tileId) {
    case "posture_score":
      return "posture_score";
    case "findings_donut":
      return "needs_attention";
    case "actions_ring":
      return "overdue_actions";
    // Analytical tiles — home is the /posture dashboard, not the Briefing.
    case "risks_breakdown":
    case "risk_heatmap":
    case "posture_trend":
    case "domain_posture":
    case "open_items_aging":
    case "vendor_risk":
    case "framework_gaps":
    case "compliance_coverage":
    case "inventory_grid":
      return null;
  }
}
