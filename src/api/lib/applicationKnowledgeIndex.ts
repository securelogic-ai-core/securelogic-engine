/**
 * applicationKnowledgeIndex.ts — types + pure builder for the Application
 * Knowledge Index.
 *
 * The index is the machine-generated description of the app's navigable surface
 * — its navigation hierarchy, menus/dropdowns, labels, routes, page titles, and
 * per-item permissions — derived from the real source of truth:
 *   - `app/src/lib/navigation.ts` (NAV_ITEMS: the header menu), and
 *   - the `app/src/app/**` route tree (every `page.tsx`).
 *
 * This module is PURE (no filesystem, no app imports, no generated import) so
 * it ships in the engine build and is safe to import at runtime. The actual
 * discovery (reading nav + scanning routes) happens in
 * `scripts/generate-app-knowledge-index.ts` and the drift test — both of which
 * call `buildApplicationKnowledgeIndex()` and live OUTSIDE the engine build.
 * The committed result is `applicationKnowledgeIndex.generated.ts`.
 *
 * "Ask SecureLogic" consumes the generated index (via productKnowledge.ts) so
 * its navigation answers are derived from the menu, never hand-written.
 */

/** Entitlement required to see a destination (mirrors app/layout.tsx gating). */
export type NavAccess = "all" | "premium" | "platform" | "admin";

/** Structural shape of an app NAV_ITEM — declared locally so this lib does not import app code. */
export type NavInputItem =
  | { type: "link"; label: string; href: string; platform?: boolean; premium?: boolean; admin?: boolean }
  | {
      type: "group";
      label: string;
      platform?: boolean;
      premium?: boolean;
      admin?: boolean;
      items: Array<{ label: string; href: string }>;
    };

/**
 * Structural shape of an app SECONDARY_NAV_ITEM (account / settings surfaces
 * reached from the user menu, not the header) — declared locally so this lib
 * does not import app code. `access` is DECLARED on the input when the page
 * restricts who can use it: these pages gate in their Server Component body
 * (role redirect, entitlement upsell), which is invisible to both the route
 * scanner and this builder, so it cannot be reliably inferred. Omit `access`
 * for a signed-in-only page and the builder defaults it to "all".
 */
export type SecondaryNavInputItem = { label: string; href: string; group: string; access?: NavAccess };

/** A discovered page route (one `page.tsx`). */
export type RawRoute = { path: string; dynamic: boolean };

export type IndexNavChild = { label: string; href: string };

export type IndexNavItem =
  | { type: "link"; label: string; href: string; access: NavAccess }
  | { type: "group"; label: string; access: NavAccess; children: IndexNavChild[] };

/** A flattened navigable destination (a top-level link or a dropdown item). */
export type IndexDestination = {
  label: string;
  href: string;
  access: NavAccess;
  /** Parent menu group label, or null for a top-level link. */
  group: string | null;
};

export type IndexRoute = {
  path: string;
  dynamic: boolean;
  /** The menu label that links directly here (the page "title"), or null if not a menu destination. */
  navLabel: string | null;
  /** Entitlement: exact menu destination, else inherited from the nearest parent destination, else "all". */
  access: NavAccess;
};

/**
 * A customer-facing account/settings destination (from SECONDARY_NAV_ITEMS).
 * `access` is the entitlement declared on the source item (mirroring the real
 * page-body guard), defaulting to "all" when the item declares none.
 */
export type IndexSecondaryItem = {
  label: string;
  href: string;
  /** Grouping label for rendering (e.g. "Account", "Settings", "Billing"). */
  group: string;
  access: NavAccess;
};

export type ApplicationKnowledgeIndex = {
  version: number;
  navigation: IndexNavItem[];
  destinations: IndexDestination[];
  routes: IndexRoute[];
  /**
   * Account / settings / billing / onboarding destinations reached from the
   * user menu rather than the header. Built from SECONDARY_NAV_ITEMS; each href
   * is a real page route (drift-locked by the index test) and each `access` is
   * the entitlement declared on the source item.
   */
  secondaryNavigation: IndexSecondaryItem[];
};

// v2 adds `secondaryNavigation` (account/settings surfaces) to the schema.
export const APPLICATION_KNOWLEDGE_INDEX_VERSION = 2;

function accessOf(item: { platform?: boolean; premium?: boolean; admin?: boolean }): NavAccess {
  if (item.admin) return "admin";
  if (item.platform) return "platform";
  if (item.premium) return "premium";
  return "all";
}

/**
 * Pure: turn the nav config + discovered routes into the index. Deterministic
 * (routes sorted by path; navigation/destinations in source order) so the
 * generated artifact and the drift-test rebuild compare equal.
 */
export function buildApplicationKnowledgeIndex(
  nav: NavInputItem[],
  rawRoutes: RawRoute[],
  secondaryNav: SecondaryNavInputItem[] = []
): ApplicationKnowledgeIndex {
  const navigation: IndexNavItem[] = nav.map((item) => {
    const access = accessOf(item);
    return item.type === "group"
      ? {
          type: "group" as const,
          label: item.label,
          access,
          children: item.items.map((c) => ({ label: c.label, href: c.href })),
        }
      : { type: "link" as const, label: item.label, href: item.href, access };
  });

  const destinations: IndexDestination[] = [];
  for (const item of nav) {
    const access = accessOf(item);
    if (item.type === "link") {
      destinations.push({ label: item.label, href: item.href, access, group: null });
    } else {
      for (const c of item.items) {
        destinations.push({ label: c.label, href: c.href, access, group: item.label });
      }
    }
  }

  const seen = new Set<string>();
  const routes: IndexRoute[] = [];
  for (const r of rawRoutes) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);

    let exact: IndexDestination | null = null;
    let prefix: IndexDestination | null = null;
    for (const d of destinations) {
      if (d.href === r.path) {
        exact = d;
      } else if (
        r.path.startsWith(d.href + "/") &&
        (prefix === null || d.href.length > prefix.href.length)
      ) {
        prefix = d;
      }
    }
    const owner = exact ?? prefix;
    routes.push({
      path: r.path,
      dynamic: r.dynamic,
      navLabel: exact ? exact.label : null,
      access: owner ? owner.access : "all",
    });
  }
  routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Secondary navigation: entitlement is the value DECLARED on the source item
  // (mirroring the page-body guard the scanner/builder cannot see). Only when an
  // item declares no access do we fall back to the header-derived route access,
  // then to "all" for a signed-in destination — inference is never allowed to
  // override an explicit declaration. Source order is preserved so the generated
  // artifact and the rebuild compare equal.
  const routeAccess = new Map(routes.map((r) => [r.path, r.access]));
  const secondaryNavigation: IndexSecondaryItem[] = secondaryNav.map((item) => ({
    label: item.label,
    href: item.href,
    group: item.group,
    access: item.access ?? routeAccess.get(item.href) ?? "all",
  }));

  return { version: APPLICATION_KNOWLEDGE_INDEX_VERSION, navigation, destinations, routes, secondaryNavigation };
}

// ---------------------------------------------------------------------------
// Query helpers (used by productKnowledge.ts and the regression tests).
// ---------------------------------------------------------------------------

export function allRoutePaths(index: ApplicationKnowledgeIndex): string[] {
  return index.routes.map((r) => r.path);
}

/** True if `path` is a known route — exact match, or a known dynamic route with the same shape. */
export function hasRoute(index: ApplicationKnowledgeIndex, path: string): boolean {
  return index.routes.some((r) => r.path === path);
}

/** The menu destination that links to `path`, if any. */
export function destinationForPath(
  index: ApplicationKnowledgeIndex,
  path: string
): IndexDestination | null {
  return index.destinations.find((d) => d.href === path) ?? null;
}
