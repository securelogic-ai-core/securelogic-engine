/**
 * navigation.ts — the single source of truth for the app's top navigation.
 *
 * This is plain, dependency-free data (no React, no Next imports) so it can be:
 *   - rendered by the header (`components/Header.tsx`), and
 *   - read by the Application Knowledge Index generator
 *     (`scripts/generate-app-knowledge-index.ts`) to auto-derive the navigation
 *     hierarchy, menus, dropdowns, labels, and permissions that "Ask
 *     SecureLogic" uses to answer platform-navigation questions.
 *
 * Because both the live UI and the generated index come from THIS array, the
 * assistant's navigation answers cannot drift from the real menu — a
 * regression test regenerates the index from this file and fails on any
 * mismatch.
 *
 * Entitlement flags mirror the gating computed in `app/layout.tsx`:
 *   - platform → visible to premium / platform / team tiers
 *   - premium  → visible to premium / professional / platform / team tiers
 *   - admin    → visible to admin-role users only
 * An item with no flag is visible to everyone signed in.
 */

/**
 * Feature-flag keys a nav item may declare via `featureFlag`. A flagged item is
 * hidden unless the caller passes `flags` with that key === true — FAIL-CLOSED, so a
 * dark feature's nav entry can ship in code while staying invisible everywhere the
 * flag is off. The server layout resolves the env flag and threads it through the
 * (client) Header, since client components can't read non-NEXT_PUBLIC env vars.
 */
export type NavFeatureFlag =
  | "enterprise_context"
  | "asset_registry"
  | "risk_intelligence"
  // Enterprise Risk Workspace IA/nav (ERIP Packages 1+2) — DARK (default off).
  // When on, `getNavItems` returns WORKSPACE_NAV_ITEMS (the enterprise-workflow
  // information architecture: Intelligence / Risk Operations / Assets / Compliance)
  // instead of the legacy NAV_ITEMS. Flag off is byte-for-byte the legacy header.
  | "risk_workspace"
  // The Briefing (Briefing Initiative B1) — DARK (default off). When on TOGETHER
  // with risk_workspace, the workspace nav's "/dashboard" entry is relabeled
  // "Briefing". It NEVER touches the legacy NAV_ITEMS (the live flag-off menu and
  // the source of the generated Application Knowledge Index), so flag-off nav and
  // the knowledge index stay byte-identical. Vocabulary: the "Briefing" label was
  // operator-ratified (2026-07-21) — deliberately distinct from the Intelligence
  // group's "Briefs" (the Intelligence Brief wedge product).
  | "briefing";
export type NavFlags = Partial<Record<NavFeatureFlag, boolean>>;

export type NavItem =
  | { type: "link"; label: string; href: string; platform?: boolean; premium?: boolean; admin?: boolean; featureFlag?: NavFeatureFlag }
  | {
      type: "group";
      label: string;
      platform?: boolean;
      premium?: boolean;
      admin?: boolean;
      featureFlag?: NavFeatureFlag;
      // A child MAY declare per-child flag gating, filtered by filterNav:
      //   - featureFlag  → SHOW this child only when the flag is on (fail-closed;
      //     e.g. the Asset Registry under "Assets" stays dark until its flag flips).
      //   - hiddenByFlag → HIDE this child when the flag is on. Used for LEGACY
      //     children that a canonical destination replaces: while the flag is off
      //     they are the menu (back-compat); once it is on they drop out of the
      //     primary nav entirely (their direct routes still work — EAR-AD-1).
      // A child with neither flag is always visible (subject to the group's own
      // entitlement). featureFlag + hiddenByFlag are mutually exclusive per child.
      items: Array<{
        label: string;
        href: string;
        featureFlag?: NavFeatureFlag;
        hiddenByFlag?: NavFeatureFlag;
        // Optional per-child entitlement gating, mirroring the link-level flags.
        // Legacy NAV_ITEMS children set none of these (so behavior is unchanged);
        // WORKSPACE_NAV_ITEMS uses them to keep, e.g., "Review Links" platform-only
        // inside an Intelligence group that must stay visible to Brief-tier users.
        platform?: boolean;
        premium?: boolean;
        admin?: boolean;
      }>;
    };

export const NAV_ITEMS: NavItem[] = [
  { type: "link",  label: "Dashboard", href: "/dashboard" },
  { type: "link",  label: "Briefs",    href: "/briefs" },
  // Search and Ask SecureLogic are NOT here. They are GLOBAL UTILITIES rendered
  // in the header's upper-right cluster at every breakpoint (see
  // GLOBAL_UTILITY_ITEMS below and `components/GlobalUtilities.tsx`). Primary
  // navigation is workspaces; find (Search) and understand (Ask) are utilities
  // available from every workspace. Their routes, gating, and behavior are
  // unchanged — only where the entry point lives changed.
  { type: "link",  label: "Queue",     href: "/queue",     platform: true },
  // Assets — the unified Asset Registry is the SINGLE canonical entry point
  // (EAR P12). When SECURELOGIC_ASSET_REGISTRY_ENABLED is on, the "Assets"
  // dropdown exposes ONLY "Asset Registry"; Vendors and AI Systems are managed
  // INSIDE the registry as asset types/filters, not as separate menu items
  // (hiddenByFlag drops them from the primary nav). Their direct routes
  // (/vendors, /ai-systems and children) keep working for back-compat and
  // deep-links (EAR-AD-1). While the flag is dark the Asset Registry child is
  // hidden (fail-closed) and the two legacy children remain, so the dropdown is
  // byte-identical to the legacy [Vendors, AI Systems] menu — dark model preserved.
  { type: "group", label: "Assets", platform: true,
    items: [
      { label: "Asset Registry", href: "/assets",      featureFlag: "asset_registry" },
      { label: "Vendors",        href: "/vendors",     hiddenByFlag: "asset_registry" },
      { label: "AI Systems",     href: "/ai-systems",  hiddenByFlag: "asset_registry" },
    ],
  },
  // Third-party assurance is a first-class Platform workspace, not a kind of
  // asset (operator ruling, BL-4, 2026-08-15). It was previously present ONLY in
  // WORKSPACE_NAV_ITEMS, so with `risk_workspace` off — the PRODUCTION flag state
  // — the whole engagement spine (/vendor-assurance, /vendor-engagements,
  // /vendor-assurance/queue) was nav-orphaned and reachable only by typing the
  // URL, while the engine's SECURELOGIC_VENDOR_ASSURANCE_ENABLED had it live.
  // It is declared here as well so the capability is reachable in BOTH nav
  // models, and so the Application Knowledge Index — generated from NAV_ITEMS
  // only — can finally give Ask a real navigation path to it instead of
  // `navLabel: null`.
  //
  // NOT repeated here: "Vendors". The workspace nav carries it inside this group
  // because `asset_registry` hides it under Assets; in the legacy nav with that
  // flag off it is still reachable at Assets → Vendors, and duplicating it would
  // put the same destination in two menus at once.
  { type: "group", label: "Vendor Assurance", platform: true,
    items: [
      { label: "Overview",       href: "/vendor-assurance" },
      { label: "Engagements",    href: "/vendor-engagements" },
      { label: "Document Queue", href: "/vendor-assurance/queue" },
    ],
  },
  // Enterprise Context Layer — DARK: featureFlag keeps this hidden until the
  // app-side SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED env is true (GATE B for prod).
  { type: "link", label: "Context", href: "/enterprise-context", platform: true, featureFlag: "enterprise_context" },
  // ERIP Executive Risk dashboard — DARK behind the app-side
  // SECURELOGIC_RISK_INTELLIGENCE_ENABLED env (two-switch model; the engine's
  // risk/predictive/health routes 404 independently until their own flags flip).
  { type: "link", label: "Executive", href: "/executive", platform: true, featureFlag: "risk_intelligence" },
  { type: "group", label: "Compliance", platform: true,
    items: [
      { label: "Controls",    href: "/controls" },
      { label: "Frameworks",  href: "/frameworks" },
      { label: "Policies",    href: "/policies" },
      { label: "Obligations", href: "/obligations" },
    ],
  },
  { type: "group", label: "Risk", platform: true,
    items: [
      { label: "Findings",      href: "/findings" },
      { label: "Actions",       href: "/actions" },
      { label: "Risk Register", href: "/risks" },
    ],
  },
  { type: "link", label: "Audit Log", href: "/audit-log", admin: true },
];

// ─── Enterprise Risk Workspace nav (ERIP Packages 1+2) ────────────────────────
//
// The Finding-centric / Asset-context information architecture, organized around
// the enterprise workflow (Intelligence → Risk Operations → Assets → Compliance)
// rather than the implementation surface. Selected by `getNavItems` ONLY when the
// `risk_workspace` flag is on; otherwise the legacy NAV_ITEMS above is returned
// byte-for-byte (GATE B — flag-off is unchanged).
//
// Design decisions realized here (see ENTERPRISE-RISK-WORKSPACE-AUDIT.md §5.3):
//   - "Intelligence" gathers the funnel INTO findings: Briefs (ungated — the
//     wedge, must stay visible to Brief-tier) + "Review Links" (the reskinned
//     matcher queue, platform-only via per-child gating).
//   - "Risk Operations" is the risk work hub. It leads with the two task-oriented
//     destinations (Operations Workspace, then Finding Explorer) and surfaces
//     Approvals, which is otherwise reachable only from a /risks back-link.
//   - "Assets" surfaces Vendor Assurance (otherwise nav-orphaned) and keeps the
//     EAR asset_registry canonical-entry behavior (EAR-AD-1) unchanged.
//   - Ask and Search are NOT here — both are GLOBAL UTILITIES in the header's
//     upper-right cluster (GLOBAL_UTILITY_ITEMS). Ask was previously demoted to
//     the user menu; it is now a first-class global action instead. Both routes
//     stay fully reachable with unchanged gating.
// NOTE: Package 3 (page merges) and Package 4 (workflow convergence) are NOT in
// scope — Actions and both Vendor pages remain distinct items.
export const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { type: "link", label: "Dashboard", href: "/dashboard" },
  // Posture Dashboard — the canonical org-performance destination (read-surface
  // architecture D1). Previously nav-orphaned in BOTH IAs; surfaced here so the
  // Dashboards concept survives the /dashboard → Briefing relabel. Legacy
  // NAV_ITEMS (the live flag-off menu + knowledge-index source) is deliberately
  // untouched.
  { type: "link", label: "Posture", href: "/posture", platform: true },
  { type: "link", label: "Executive", href: "/executive", platform: true, featureFlag: "risk_intelligence" },
  { type: "group", label: "Intelligence",
    items: [
      { label: "Briefs",       href: "/briefs" },
      { label: "Review Links", href: "/queue", platform: true },
    ],
  },
  // Risk Operations exposes the two DISTINCT user intents that both live on the
  // /findings route, which previously appeared as a single "Findings" item:
  //   - "Operations Workspace" (/findings) — "take me where I do my daily work":
  //     the work queues, assignments, governance workflow, SLA and independent
  //     review surface. It lists no finding rows; it organizes work.
  //   - "Finding Explorer" (/findings?queue=all) — "take me where I search and
  //     investigate": the complete searchable inventory of findings.
  // The Explorer was previously reachable ONLY from a link at the bottom of the
  // workspace, so the inventory was effectively nav-orphaned. Both entries point
  // at existing URLs — no route, param, or handler changed.
  { type: "group", label: "Risk Operations", platform: true,
    items: [
      { label: "Operations Workspace", href: "/findings" },
      { label: "Finding Explorer",     href: "/findings?queue=all" },
      { label: "Actions",              href: "/actions" },
      { label: "Risk Register",        href: "/risks" },
      { label: "Approvals",            href: "/approvals" },
    ],
  },
  { type: "group", label: "Assets", platform: true,
    items: [
      { label: "Asset Registry",   href: "/assets",                   featureFlag: "asset_registry" },
      { label: "Vendors",          href: "/vendors",                  hiddenByFlag: "asset_registry" },
      { label: "AI Systems",       href: "/ai-systems",               hiddenByFlag: "asset_registry" },
    ],
  },
  // Third-party assurance is one of the platform's top-level capabilities, not a
  // kind of asset. It previously appeared as a SINGLE child under "Assets"
  // pointing at /vendor-assurance/queue — the document review queue, which is one
  // evidence step. The engagement spine (/vendor-engagements: intake and inherent
  // risk → questionnaire → vendor portal → responses and evidence → internal
  // review → findings → residual → decision → monitoring) was fully built and
  // nav-orphaned in EVERY IA variant, so the workflow could only be reached by
  // typing the URL. "Vendors" is repeated here because the asset_registry flag
  // hides it under Assets, which otherwise leaves the vendor list — where an
  // engagement is opened from — unreachable whenever that flag is on.
  { type: "group", label: "Vendor Assurance", platform: true,
    items: [
      { label: "Overview",       href: "/vendor-assurance" },
      { label: "Engagements",    href: "/vendor-engagements" },
      { label: "Document Queue", href: "/vendor-assurance/queue" },
      { label: "Vendors",        href: "/vendors" },
    ],
  },
  { type: "group", label: "Compliance", platform: true,
    items: [
      { label: "Controls",    href: "/controls" },
      { label: "Frameworks",  href: "/frameworks" },
      { label: "Policies",    href: "/policies" },
      { label: "Obligations", href: "/obligations" },
      // EG2 slice 8 — the org-wide evidence inventory. Workspace nav only:
      // the legacy flat nav (line ~114) stays byte-identical (EG v1 preserved).
      { label: "Evidence",    href: "/evidence" },
    ],
  },
  { type: "link", label: "Context", href: "/enterprise-context", platform: true, featureFlag: "enterprise_context" },
  { type: "link", label: "Audit Log", href: "/audit-log", admin: true },
];

// ─── Global utilities (header upper-right, every breakpoint) ──────────────────
//
// The IA rule this encodes: primary navigation is WORKSPACES; Search ("find")
// and Ask SecureLogic ("understand / analyze / interact") are UTILITIES that
// belong to no workspace because they operate across all of them. They render
// in the header's upper-right cluster next to the profile control
// (`components/GlobalUtilities.tsx`), in BOTH nav models and at every
// breakpoint — so neither is reachable only through a menu that the
// `risk_workspace` flag happens to select.
//
// `access` is DECLARED, not inferred, exactly as SECONDARY_NAV_ITEMS declares
// it: these are not nav items, so there is no `platform: true` flag for the
// index builder to read. Both values mirror the gating that was already in
// force before the move — /search redirects non-platform orgs in its page body
// and the engine's global-search route is premium-or-platform; every Ask engine
// route is `requireEntitlement("premium")`. This package moved the entry
// points, not the gates. The same values are declared in
// ROUTE_ACCESS_DECLARATIONS below so the index's ROUTES table agrees.
export type GlobalUtilityItem = {
  label: string;
  href: string;
  /** Entitlement required to actually use it (mirrors the real page/API gate). */
  access: SecondaryNavAccess;
};

export const GLOBAL_UTILITY_ITEMS: GlobalUtilityItem[] = [
  { label: "Search", href: "/search", access: "platform" },
  { label: "Ask SecureLogic", href: "/ask", access: "platform" },
];

/**
 * The nav model to render. Returns the enterprise workspace IA when the
 * `risk_workspace` flag is on, else the legacy NAV_ITEMS byte-for-byte.
 * `filterNav` (entitlement + per-item feature flags) is still applied on top by
 * the caller. The Application Knowledge Index generator reads NAV_ITEMS directly
 * (the live, flag-off menu), so it is intentionally unaffected while dark.
 */
export function getNavItems(flags?: NavFlags): NavItem[] {
  if (!flags?.risk_workspace) return NAV_ITEMS;
  if (!flags?.briefing) return WORKSPACE_NAV_ITEMS;
  // Briefing Initiative B1: relabel the home entry INSIDE the flag-gated
  // workspace nav only (cloned — the shared array is never mutated). The URL
  // stays /dashboard: every redirect gate, email link, Stripe return URL, and
  // bookmark keeps working.
  return WORKSPACE_NAV_ITEMS.map((item) =>
    item.type === "link" && item.href === "/dashboard"
      ? { ...item, label: BRIEFING_NAV_LABEL }
      : item,
  );
}

// ─── The Briefing (home destination) names ────────────────────────────────────

/** What /dashboard is CALLED when The Briefing experience is on. */
export const BRIEFING_NAV_LABEL = "Briefing";

/**
 * What `/dashboard` is CALLED right now. The route renders The Briefing only
 * under the briefing flag; with the flag off it is still the legacy Dashboard,
 * so a back-link must not promise an experience that isn't rendered. Pass the
 * resolved flag (server components read the env; clients take a prop).
 */
export function briefingHomeLabel(briefingEnabled: boolean): string {
  return briefingEnabled ? BRIEFING_NAV_LABEL : "Dashboard";
}

// ─── Risk Operations destination names ────────────────────────────────────────
//
// The two task-oriented destinations on the /findings route. Exported so back-links
// and provenance copy on OTHER surfaces (the finding detail page, the CSV importer)
// name the destination identically to the nav and the page heading, instead of each
// hardcoding its own wording.

/** "Take me where I do my daily work" — /findings under the risk_workspace flag. */
export const OPERATIONS_WORKSPACE_LABEL = "Operations Workspace";
/** "Take me where I search and investigate" — /findings?queue=all. */
export const FINDING_EXPLORER_LABEL = "Finding Explorer";

/**
 * What `/findings` is CALLED right now. The route renders the Operations Workspace
 * only under the risk_workspace flag; with the flag off it is still the legacy
 * "Findings" list, so a back-link must not promise a workspace that isn't rendered.
 * Pass the resolved flag (server components read the env; clients take a prop).
 */
export function findingsHomeLabel(riskWorkspaceEnabled: boolean): string {
  return riskWorkspaceEnabled ? OPERATIONS_WORKSPACE_LABEL : "Findings";
}

/**
 * What `/findings?queue=all` is CALLED right now. Flag off, that URL renders the
 * same single legacy list as `/findings`, so naming it "Finding Explorer" would
 * invent a destination the user cannot see; it keeps the generic wording instead.
 */
export function findingExplorerLabel(riskWorkspaceEnabled: boolean): string {
  return riskWorkspaceEnabled ? FINDING_EXPLORER_LABEL : "All findings";
}

/**
 * Whether a nav item points at the destination the user is currently viewing.
 *
 * Two Risk Operations children (Operations Workspace, Finding Explorer) share the
 * `/findings` PATH and are distinguished only by the query string, so matching on
 * `usePathname()` alone would highlight "Operations Workspace" while the user is
 * in the Explorer and never highlight the Explorer at all. The rule:
 *
 *   - href WITHOUT a query → active on a path match, but NOT when the current URL
 *     carries a query that another sibling claims exactly.
 *   - href WITH a query → active only when the path matches AND every one of the
 *     href's params is present with the same value. Extra params in the current URL
 *     (a filter or a sort the user added inside the Explorer) do not break the match.
 *
 * `search` is the raw query string (with or without a leading "?"); pass "" when
 * there is none. `matchDescendants` preserves the caller's EXISTING path semantics:
 * the top-level links and the group button already lit up on descendant routes
 * (`/risks` active on `/risks/abc`) while the dropdown children required an exact
 * path match. Keeping that split means the legacy (flag-off) menu behaves exactly as
 * it did before this helper existed. Pure and dependency-free so it stays unit-testable.
 */
export function isNavItemActive(
  href: string,
  pathname: string,
  search: string,
  siblingHrefs: readonly string[] = [],
  matchDescendants = false,
): boolean {
  const [hrefPath, hrefQuery = ""] = href.split("?");
  const pathMatches = matchDescendants
    ? pathname === hrefPath || pathname.startsWith(hrefPath + "/")
    : pathname === hrefPath;
  if (!pathMatches) return false;

  const current = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  if (hrefQuery) {
    for (const [k, v] of new URLSearchParams(hrefQuery)) {
      if (current.get(k) !== v) return false;
    }
    return true;
  }

  // Query-less href: yield to a sibling that claims this exact URL, so the
  // Explorer — not the Workspace — lights up on `/findings?queue=all`.
  return !siblingHrefs.some(
    s => s !== href && s.split("?")[1] && isNavItemActive(s, pathname, search, [], matchDescendants),
  );
}

export function filterNav(
  items: NavItem[],
  isPlatformUser: boolean,
  isPremiumUser: boolean,
  isAdminUser: boolean,
  flags?: NavFlags,
): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.featureFlag && flags?.[item.featureFlag] !== true) continue; // fail-closed
    if (item.platform && !isPlatformUser) continue;
    if (item.premium  && !isPremiumUser)  continue;
    if (item.admin    && !isAdminUser)    continue;

    if (item.type === "group") {
      // Per-child flag gating; return a cloned group so the shared NAV_ITEMS
      // array is never mutated. A group whose children all resolve away
      // disappears entirely.
      //   - featureFlag  → keep only when its flag is on (fail-closed).
      //   - hiddenByFlag → drop when its flag is on (legacy child a canonical
      //     destination has replaced).
      const visibleItems = item.items.filter(c => {
        if (c.featureFlag && flags?.[c.featureFlag] !== true) return false;
        if (c.hiddenByFlag && flags?.[c.hiddenByFlag] === true) return false;
        // Per-child entitlement gating (optional; legacy children set none of
        // these so this is a no-op for the legacy nav).
        if (c.platform && !isPlatformUser) return false;
        if (c.premium && !isPremiumUser) return false;
        if (c.admin && !isAdminUser) return false;
        return true;
      });
      if (visibleItems.length === 0) continue;
      out.push(visibleItems.length === item.items.length ? item : { ...item, items: visibleItems });
    } else {
      out.push(item);
    }
  }
  return out;
}

// ─── Secondary navigation (account / settings surfaces) ───────────────────────
//
// The top NAV_ITEMS above are the header menu. A second family of
// customer-facing destinations lives OUTSIDE the header — the account/profile
// area, billing, the per-org settings pages (security, SSO, webhooks, risk
// scale/policy), and the onboarding checklist. These are reached from the user
// menu (`components/UserMenu.tsx`) and the account/settings pages, not the
// header dropdowns, so they were never part of the header-derived knowledge the
// "Ask SecureLogic" assistant sees.
//
// This array is the machine-readable source of truth for those destinations.
// Like NAV_ITEMS, it is plain dependency-free data so the Application Knowledge
// Index generator can read it; every `href` is validated against the real
// `app/src/app/**` route tree by the drift test — the assistant can therefore
// point users to these pages without inventing paths.
//
// Entitlement (`access`) is DECLARED here, exactly as NAV_ITEMS declares its
// header flags. It must be declared — and cannot be safely inferred — because
// these pages enforce their gating in the Server Component body (e.g.
// `if (role !== "admin") redirect(...)`, or an entitlement upsell wall), which
// neither the route scanner (it only checks for a `page.tsx`) nor the index
// builder (it only reads the header NAV_ITEMS flags) can see. Declare `access`
// on any item whose page restricts who can actually use it; omit it for a
// signed-in-only destination and the builder defaults it to "all". Keep these
// values honest against the real page guards — the drift test asserts the
// gated pages still carry their guard so this metadata can't silently rot.
//
// Grouped for readable rendering; `group` order below is preserved.

/**
 * Entitlement required to actually use a secondary destination. Mirrors the
 * `NavAccess` union in the index builder, declared locally so this file stays
 * dependency-free (no engine imports).
 */
export type SecondaryNavAccess = "all" | "premium" | "platform" | "admin";

export type SecondaryNavItem = {
  label: string;
  href: string;
  group: string;
  /**
   * Entitlement required to actually use the destination, mirroring the real
   * page-body guard. Omit for signed-in-only pages (defaults to "all").
   */
  access?: SecondaryNavAccess;
};

/**
 * Declared access for BODY-GATED ROUTES that appear in neither NAV_ITEMS nor
 * SECONDARY_NAV_ITEMS (Launch Completion 2 — Ask access truth).
 *
 * The index builder derives a route's access from the nav item that owns it;
 * a body-gated page absent from both navigations therefore classified as
 * `access:"all"`, and Ask — whose prompt is rendered from the index — could
 * recommend a surface the requester's entitlement cannot reach (the page
 * redirects them to /dashboard). These declarations mirror the real page-body
 * guards, exactly as SECONDARY_NAV_ITEMS.access mirrors its pages' guards.
 *
 * Longest matching prefix wins; a declaration NEVER overrides access the
 * builder derived from a nav item (inference from an explicit menu flag beats
 * a prefix rule). The drift test regenerates the index from this array, so a
 * new body-gated route family must be declared here or the honesty test that
 * scans page bodies for entitlement guards fails the build.
 */
export const ROUTE_ACCESS_DECLARATIONS: Array<{
  prefix: string;
  access: SecondaryNavAccess;
}> = [
  // Global utilities (GLOBAL_UTILITY_ITEMS). They left the header menu for the
  // upper-right utility cluster, so the builder can no longer derive their
  // access from a nav flag. Declared here at the SAME level they carried as nav
  // items — /search redirects non-platform orgs in its page body, and every Ask
  // engine route requires the premium-or-platform entitlement, so an "all"
  // classification would have Ask recommending itself to orgs whose questions
  // would every one of them fail.
  { prefix: "/search", access: "platform" },
  { prefix: "/ask", access: "platform" },
  // Vendor Assurance — both the Tier-B document review surfaces and the
  // engagement spine are platform-gated in their page bodies.
  { prefix: "/vendor-assurance", access: "platform" },
  { prefix: "/vendor-engagements", access: "platform" },
  // Risk-operations surfaces reachable only from in-app links (nav-orphaned
  // in the legacy header): each redirects sub-platform orgs to /dashboard.
  { prefix: "/approvals", access: "platform" },
  { prefix: "/evidence", access: "platform" },
  { prefix: "/posture", access: "platform" },
  // Declared in SECONDARY_NAV_ITEMS for the secondary listing; declared here
  // too so the ROUTES table agrees (the two views must not contradict).
  { prefix: "/getting-started", access: "platform" },
  { prefix: "/account/team", access: "premium" },
  // Admin-gated settings pages (page body redirects non-admins).
  { prefix: "/settings/organization", access: "admin" },
  { prefix: "/settings/security", access: "admin" },
];

export const SECONDARY_NAV_ITEMS: SecondaryNavItem[] = [
  // Account & profile
  { group: "Account",  label: "Account, profile & billing", href: "/account" },
  // /account/team redirects starter orgs to /account (`entitlement !== "starter"`
  // in the page body) — any PAID tier is admitted, so "premium", not "platform".
  { group: "Account",  label: "Team & users",               href: "/account/team", access: "premium" },
  { group: "Account",  label: "API keys",                    href: "/account/api-keys" },
  { group: "Account",  label: "Notifications & alerts",      href: "/account/alerts" },
  { group: "Account",  label: "Privacy & data rights",       href: "/account/privacy" },
  // Billing / subscription
  { group: "Billing",  label: "Plans & pricing",             href: "/pricing" },
  // Settings
  // /settings/security redirects non-admins away; /settings/sso shows non-Pro
  // orgs an upsell wall instead of the feature. Both gates live in the page
  // body, so their entitlement is declared explicitly here.
  { group: "Settings", label: "Security settings",           href: "/settings/security", access: "admin" },
  { group: "Settings", label: "Single sign-on (SSO)",        href: "/settings/sso",      access: "premium" },
  { group: "Settings", label: "Webhooks",                    href: "/settings/webhooks" },
  { group: "Settings", label: "Risk rating scale",           href: "/settings/risk-scale" },
  { group: "Settings", label: "Risk policy",                 href: "/settings/risk-policy" },
  // Onboarding
  // /getting-started redirects orgs without platform entitlement to /dashboard
  // (every checklist step targets a platform-gated destination). The guard is
  // in the page body, so declare it here or the index would tell the Ask
  // assistant this page is open to everyone — and the assistant would send
  // free-tier customers to a checklist they cannot start.
  { group: "Onboarding", label: "Getting started checklist", href: "/getting-started", access: "platform" },
];
