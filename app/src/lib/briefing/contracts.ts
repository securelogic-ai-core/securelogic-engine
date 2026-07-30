/**
 * contracts.ts — the canonical Briefing Module contract (Briefing Initiative, B1).
 *
 * "The Briefing" is the personalized opening experience that replaces the generic
 * /dashboard composition when SECURELOGIC_DASHBOARD_BRIEFING_ENABLED is on. It
 * answers "what matters to me now?" — distinct from Operational Views (queues and
 * explorers: what do I want to inspect?) and Dashboards (/posture, /executive:
 * how is the organization performing?). A module SUMMARIZES and LINKS to those
 * surfaces; it never reproduces a data explorer on the opening screen.
 *
 * This file is PURE, SERIALIZABLE DATA CONTRACTS — no React, no fetch, no
 * component references. The id → component mapping lives in the render map
 * (app/src/app/dashboard/briefing/TheBriefing.tsx) so that a future phase can
 * generate an engine-side validation manifest from this registry mechanically
 * (the applicationKnowledgeIndex generate + drift-test pattern).
 *
 * AUTHORIZATION BOUNDARY (read before extending): the metadata here
 * (minEntitlement / requiresUserIdentity / requiredFlag) is presentation
 * composition, NOT an authorization boundary. Enforcement lives in the engine's
 * per-route middleware chain (requireApiKey → attachOrganizationContext →
 * requireEntitlement); every module's data has already passed through that chain
 * before this layer sees it. A saved layout (B2+) never grants access — module
 * resolution filters against this registry on every render, so removing a
 * module, restricting a flag, or losing an entitlement removes the module no
 * matter what any stored preference says.
 *
 * SCOPE IS EXPLICIT (cross-program principle): every module declares whether its
 * numbers are the signed-in user's ("personal" → rendered with a "You" chip) or
 * the whole organization's ("organization" chip). A personal module must be
 * OMITTED — never rendered as a fake zero — when the session has no user
 * identity (legacy API-key sessions); that is the my_work_open honest-omission
 * contract from GET /api/findings/summary.
 *
 * ── Object-model boundaries (B1.1 contract refinement) ───────────────────────
 * Four distinct concepts surround this contract. Only the FIRST exists today;
 * the others are documented so later phases extend the model instead of
 * blurring it:
 *
 *   1. The canonical MODULE REGISTRY (this file + registry.ts) — the catalog of
 *      what modules EXIST: identity, meaning, scope, authorization-relevant
 *      metadata, destination. Code-owned, organization-independent,
 *      user-independent. Mirrored engine-side as a GENERATED, drift-tested
 *      manifest (src/api/lib/briefingModuleManifest.generated.ts).
 *   2. The persisted USER LAYOUT (B2 — not built) — a per-user, org-scoped,
 *      VERSIONED selection/ordering/configuration of module INSTANCES that
 *      references registry ids. It owns nothing about what a module IS; it
 *      owns only which/where/how-configured for one user. The ratified
 *      persistence direction (instance-shaped entries, not bare ids) is
 *      documented in docs/specs/briefing-initiative-b1-spec.md — read it
 *      before designing the B2 schema.
 *   3. BRIEFING PROFILES (B3 — not built) — named, purposeful layouts a user
 *      switches between (e.g. Morning / Audit / Incident). A profile is a
 *      layout with identity and lifecycle; it introduces NO second module
 *      system and NO second persistence path.
 *   4. ORGANIZATIONAL BRIEFINGS (B4 — not built) — admin-published templates
 *      assigned through the EXISTING org/role structures, from which user
 *      layouts inherit. Mandatory-module policy lives HERE (a per-org template
 *      property), never in the registry — SecureLogic does not decide what is
 *      mandatory inside a tenant.
 *
 * Layers 2–4 REFERENCE registry ids; they never restate module metadata.
 * Eligibility (entitlement × identity × flags) is re-resolved against this
 * registry on EVERY render, so a stored layout, profile, or template can never
 * grant access — permissions override personalization.
 *
 * ── Evolution policy (binding) ────────────────────────────────────────────────
 *   - Module ids are IMMUTABLE and are never reused for a different meaning.
 *   - Contract changes are OPTIONAL-ADDITIVE only. Removing a module or field,
 *     or changing a field's meaning, requires a manifest schema_version bump
 *     plus an explicit layout-migration step owned by the phase that does it.
 *   - No speculative fields: a field lands with its first consumer, not before.
 *   - The engine manifest is always regenerated
 *     (`npm run generate:briefing-manifest`) and drift-tested — never
 *     hand-edited.
 */

/**
 * The twelve legacy PostureDashboard tile ids — the vocabulary persisted today in
 * dashboard_preferences.layout and validated by the engine's VALID_TILE_IDS
 * (src/api/routes/dashboardPreferences.ts). B1 does not read those preferences
 * (the Briefing renders the canonical default composition); the ids are kept here
 * because they are B2's migration key: registry.legacyTileToModule() is the
 * pure, tested legacy-tile → briefing-module projection the B2 preference
 * migration will apply.
 */
export const LEGACY_DASHBOARD_TILE_IDS = [
  "posture_score",
  "risks_breakdown",
  "risk_heatmap",
  "posture_trend",
  "findings_donut",
  "domain_posture",
  "actions_ring",
  "open_items_aging",
  "vendor_risk",
  "framework_gaps",
  "compliance_coverage",
  "inventory_grid",
] as const;
export type LegacyDashboardTileId = (typeof LEGACY_DASHBOARD_TILE_IDS)[number];

/** Stable module identities. Additive-only once a phase ships them. */
export const BRIEFING_MODULE_IDS = [
  "whats_changed",
  "my_work",
  "my_pending_reviews",
  "needs_attention",
  "overdue_actions",
  "ready_to_close",
  "posture_score",
  "recent_findings",
  "latest_brief",
] as const;
export type BriefingModuleId = (typeof BRIEFING_MODULE_IDS)[number];

/** Whose numbers a module shows — rendered as an explicit chip, never implied. */
export type BriefingScope = "personal" | "organization";

/**
 * Priority zones of the DEFAULT composition. "your_work" leads (personal,
 * assignment-driven), then the organization-wide operational picture, then
 * intelligence.
 *
 * B1.1 clarification: a module's `zone` is its placement in the canonical
 * DEFAULT composition — it is NOT a hard constraint on where the module may
 * ever appear. Future layouts, profiles, and organizational templates (B2–B4)
 * may position any ELIGIBLE module explicitly (an Incident profile may lead
 * with recent findings). The invariant that survives re-zoning is the scope
 * chip — a personal module is visually distinct from an organizational one
 * wherever it is placed — not the zone.
 */
export type BriefingZone = "your_work" | "organization" | "intelligence";

/** Logical module family — the classification axis for the picker (B2+). */
export type BriefingCategory =
  | "my_work"
  | "findings"
  | "actions"
  | "posture"
  | "intelligence";

/**
 * App feature flags a module may depend on. Fail-closed: a module whose flag is
 * off resolves away entirely (its destination queue does not exist without it).
 */
export type BriefingFlagKey = "independent_review";

// ── Persisted layout envelope (B2 — first consumer of the B1.1 direction) ────
/**
 * The instance-shaped, versioned envelope persisted per (org, user) in the
 * engine's `briefing_layouts` table (docs/specs/briefing-initiative-b2-spec.md).
 * B2 invariants (engine-enforced in briefingLayoutValidation.ts):
 * `instanceKey === moduleId` (single-instance phase) and `config === {}` (fields
 * land with their first consumer). The layout is the COMPLETE ordered statement
 * of what is shown — absence = hidden. Eligibility is re-resolved against the
 * registry on every render; a stored layout never grants access.
 */
export const BRIEFING_LAYOUT_VERSION = 1;

export type BriefingLayoutModuleEntry = {
  /** Registry id — the module's IDENTITY. */
  moduleId: BriefingModuleId;
  /** Stable per-instance key; equals moduleId while layouts are single-instance. */
  instanceKey: string;
  /** Per-instance configuration — empty in B2 (evolution policy). */
  config: Record<string, never>;
};

export type BriefingLayoutEnvelope = {
  version: typeof BRIEFING_LAYOUT_VERSION;
  modules: BriefingLayoutModuleEntry[];
};

export type BriefingModuleDef = {
  id: BriefingModuleId;
  /** Display name, as shown in the module header and the future picker. */
  title: string;
  /** One-line purpose, for the future picker — not rendered on the Briefing itself. */
  description: string;
  zone: BriefingZone;
  category: BriefingCategory;
  scope: BriefingScope;
  /**
   * Personal modules require a session user identity (JWT). Without one the
   * module is omitted — the honest-omission contract, never a zero.
   */
  requiresUserIdentity: boolean;
  /**
   * Minimum display tier. "platform" mirrors the page's isPlatformUser branch
   * (premium | platform | team). Presentation-side defense in depth only — see
   * the authorization-boundary note above.
   */
  minEntitlement: "platform" | "all";
  requiredFlag?: BriefingFlagKey;
  /**
   * Primary drill-down: the operational view or dashboard that REPRODUCES the
   * module's headline number. Module bodies may carry additional, narrower
   * links, but each must reconcile with the number it sits beside.
   */
  destination: string;
  /**
   * The legacy PostureDashboard tile this module supersedes, when one exists.
   * null = a Briefing-native module with no legacy counterpart.
   */
  legacyTileId: LegacyDashboardTileId | null;
};
