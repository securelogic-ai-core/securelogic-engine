import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
  ROUTE_ACCESS_DECLARATIONS,
  GLOBAL_UTILITY_ITEMS,
} from "../../../app/src/lib/navigation.js";
import { scanAppRoutes } from "../../../scripts/lib/scanAppRoutes.js";
import {
  buildApplicationKnowledgeIndex,
  type NavInputItem,
  type SecondaryNavInputItem,
  type GlobalUtilityInputItem,
} from "../lib/applicationKnowledgeIndex.js";
import { APPLICATION_KNOWLEDGE_INDEX } from "../lib/applicationKnowledgeIndex.generated.js";
import { renderProductKnowledge } from "../lib/productKnowledge.js";

const here = dirname(fileURLToPath(import.meta.url));
const appAppDir = join(here, "..", "..", "..", "app", "src", "app");

// Rebuild the index from the live sources exactly as the generator does.
const rebuilt = buildApplicationKnowledgeIndex(
  NAV_ITEMS as NavInputItem[],
  scanAppRoutes(appAppDir),
  SECONDARY_NAV_ITEMS as SecondaryNavInputItem[],
  ROUTE_ACCESS_DECLARATIONS,
  GLOBAL_UTILITY_ITEMS as GlobalUtilityInputItem[]
);

const routePaths = new Set(APPLICATION_KNOWLEDGE_INDEX.routes.map((r) => r.path));

/** Read a page's Server Component source so tests can assert its real guard. */
const pageSource = (route: string): string =>
  readFileSync(join(appAppDir, route, "page.tsx"), "utf8");

const secondaryByHref = (href: string) =>
  APPLICATION_KNOWLEDGE_INDEX.secondaryNavigation.find((d) => d.href === href);

describe("Application Knowledge Index — committed artifact is not stale", () => {
  it("the committed index equals a fresh rebuild from nav + route tree (run `npm run generate:knowledge-index` if this fails)", () => {
    expect(rebuilt).toEqual(APPLICATION_KNOWLEDGE_INDEX);
  });

  it("discovered a non-trivial route tree and the full menu", () => {
    expect(APPLICATION_KNOWLEDGE_INDEX.routes.length).toBeGreaterThan(20);
    expect(APPLICATION_KNOWLEDGE_INDEX.navigation.length).toBe(NAV_ITEMS.length);
  });
});

describe("Navigation hierarchy matches the actual UI", () => {
  it("every menu destination links to a real page route", () => {
    for (const d of APPLICATION_KNOWLEDGE_INDEX.destinations) {
      expect(routePaths.has(d.href), `menu "${d.label}" → ${d.href} has no page.tsx`).toBe(true);
    }
  });

  it("every menu destination carries a valid access level", () => {
    const valid = new Set(["all", "premium", "platform", "admin"]);
    for (const d of APPLICATION_KNOWLEDGE_INDEX.destinations) {
      expect(valid.has(d.access), `${d.label} access=${d.access}`).toBe(true);
    }
  });

  it("preserves dropdown grouping from the menu (Assets / Compliance / Risk)", () => {
    const groups = APPLICATION_KNOWLEDGE_INDEX.navigation
      .filter((n) => n.type === "group")
      .map((n) => n.label);
    expect(groups).toEqual(expect.arrayContaining(["Assets", "Compliance", "Risk"]));
  });

  it("carries entitlement: Dashboard is open", () => {
    const dash = APPLICATION_KNOWLEDGE_INDEX.destinations.find((d) => d.href === "/dashboard");
    expect(dash?.access).toBe("all");
  });

  it("child routes inherit access from their parent menu destination (e.g. /vendors/new = platform)", () => {
    const r = APPLICATION_KNOWLEDGE_INDEX.routes.find((x) => x.path === "/vendors/new");
    expect(r?.access).toBe("platform");
  });
});

// ERIP Package 3.3 guard: Intelligence Events are a DRILL-THROUGH ONLY surface
// (reached from a Finding / Review Links), never customer-facing primary
// navigation (design §6). This test fails the build if anyone adds an
// /intelligence nav entry or a standalone /intelligence index route.
describe("Intelligence Events remain drill-through only (ERIP P3.3)", () => {
  it("registers /intelligence/[id] as a route but NEVER as primary navigation", () => {
    const route = APPLICATION_KNOWLEDGE_INDEX.routes.find((r) => r.path === "/intelligence/[id]");
    expect(route, "the drill-through route /intelligence/[id] should exist").toBeTruthy();
    expect(route?.navLabel, "/intelligence/[id] must not carry a nav label").toBeNull();
  });

  it("has no /intelligence entry in primary navigation or menu destinations", () => {
    const inNav = APPLICATION_KNOWLEDGE_INDEX.destinations.some((d) => d.href.startsWith("/intelligence"));
    expect(inNav, "no /intelligence entry may appear in primary navigation").toBe(false);
  });

  it("has no standalone /intelligence index route (drill-through only, no list)", () => {
    const indexRoute = APPLICATION_KNOWLEDGE_INDEX.routes.some((r) => r.path === "/intelligence");
    expect(indexRoute, "there must be no /intelligence index route").toBe(false);
  });
});

describe("Secondary navigation (account / settings surfaces) is drift-locked to real routes", () => {
  it("carries the account/settings surfaces (non-empty)", () => {
    expect(APPLICATION_KNOWLEDGE_INDEX.secondaryNavigation.length).toBe(
      SECONDARY_NAV_ITEMS.length
    );
    expect(APPLICATION_KNOWLEDGE_INDEX.secondaryNavigation.length).toBeGreaterThan(0);
  });

  it("every secondary destination links to a real page route (no invented paths)", () => {
    for (const d of APPLICATION_KNOWLEDGE_INDEX.secondaryNavigation) {
      expect(routePaths.has(d.href), `secondary "${d.label}" → ${d.href} has no page.tsx`).toBe(true);
    }
  });

  it("declares a valid access level on every secondary destination", () => {
    const valid = new Set(["all", "premium", "platform", "admin"]);
    for (const d of APPLICATION_KNOWLEDGE_INDEX.secondaryNavigation) {
      expect(valid.has(d.access), `${d.label} has invalid access ${d.access}`).toBe(true);
    }
  });
});

// These lock the *declared* entitlement of the two gated surfaces to the real
// page-body guard. The guard lives in the Server Component (not the header nav
// or the route file tree), so nothing else in this suite can catch it drifting.
// If a guard is removed or changed, update SECONDARY_NAV_ITEMS.access to match —
// these tests exist so that metadata can never silently misrepresent access.
describe("Secondary-nav access metadata matches the real page guard", () => {
  it("/settings/security is admin-gated (page redirects non-admins) and declared admin", () => {
    const src = pageSource("settings/security");
    expect(src, "security page no longer guards on admin role").toMatch(
      /role\s*!==\s*"admin"/
    );
    expect(src, "security page no longer redirects non-admins").toContain("redirect(");
    expect(secondaryByHref("/settings/security")?.access).toBe("admin");
  });

  it("/settings/sso is premium/upsell-gated (non-Pro sees an upsell wall) and declared premium", () => {
    const src = pageSource("settings/sso");
    // Non-Pro orgs fall into the `if (!isPro)` branch that renders an upsell
    // instead of the SSO configuration form.
    expect(src, "sso page no longer computes a Pro entitlement").toMatch(/isPro\b/);
    expect(src, "sso page no longer branches to an upsell for non-Pro").toMatch(
      /if\s*\(\s*!isPro\s*\)/
    );
    expect(secondaryByHref("/settings/sso")?.access).toBe("premium");
  });

  it("/getting-started is platform-gated (page redirects unentitled orgs) and declared platform", () => {
    // Every checklist step targets a platform-gated destination, so the page
    // redirects orgs outside the platform entitlement triad. If that guard is
    // ever removed, this must fail — an index that says "all" would have the
    // Ask assistant sending free-tier customers to a checklist they cannot
    // start, which is exactly the false claim the declaration exists to stop.
    const src = pageSource("getting-started");
    expect(src, "getting-started page no longer checks platform entitlement").toMatch(
      /isPlatformEntitled\s*\(/
    );
    expect(src, "getting-started page no longer redirects unentitled orgs").toMatch(
      /redirect\("\/dashboard"\)/
    );
    expect(secondaryByHref("/getting-started")?.access).toBe("platform");
  });
});

describe("Ask navigation answers are grounded in the index", () => {
  it("the rendered product knowledge lists every top-level menu link from the index", () => {
    const rendered = renderProductKnowledge();
    for (const n of APPLICATION_KNOWLEDGE_INDEX.navigation) {
      if (n.type === "link") {
        expect(rendered, `missing nav link ${n.label}`).toContain(`${n.label} → ${n.href}`);
      } else {
        for (const c of n.children) {
          expect(rendered, `missing dropdown item ${c.label}`).toContain(`${c.label} → ${c.href}`);
        }
      }
    }
  });

  it("the rendered product knowledge lists every secondary (account/settings) destination", () => {
    const rendered = renderProductKnowledge();
    for (const d of APPLICATION_KNOWLEDGE_INDEX.secondaryNavigation) {
      expect(rendered, `missing secondary destination ${d.label}`).toContain(`${d.label} → ${d.href}`);
    }
  });
});

/**
 * Global utilities (index v3) — Search and Ask SecureLogic left the primary
 * menu for the header's upper-right cluster. The index has to describe them as
 * what they now are: reachable from EVERY page, and therefore not a menu item
 * the assistant should tell a caller to go find in the navigation.
 */
describe("Global utilities are indexed as utilities, not as menu destinations", () => {
  const utilityByHref = (href: string) =>
    APPLICATION_KNOWLEDGE_INDEX.globalUtilities.find((u) => u.href === href);

  it("the committed artifact is v3 and carries the utilities section", () => {
    // A v2 artifact still typechecks against an optional field and would simply
    // render no section — the prompt would lose Ask and Search silently.
    expect(APPLICATION_KNOWLEDGE_INDEX.version).toBe(3);
    expect(APPLICATION_KNOWLEDGE_INDEX.globalUtilities).toHaveLength(2);
  });

  it("lists Search and Ask at platform tier, pointing at real page routes", () => {
    expect(utilityByHref("/search")).toMatchObject({ label: "Search", access: "platform" });
    expect(utilityByHref("/ask")).toMatchObject({ label: "Ask SecureLogic", access: "platform" });
    for (const u of APPLICATION_KNOWLEDGE_INDEX.globalUtilities) {
      expect(routePaths.has(u.href), `utility "${u.label}" → ${u.href} has no page.tsx`).toBe(true);
    }
  });

  it("does not also list them as menu destinations", () => {
    // `destinations` means "reachable from the header menu". Leaving a utility
    // in both tables is how the assistant ends up telling a caller to look for
    // an entry that is not in the menu they are staring at.
    const destinationHrefs = APPLICATION_KNOWLEDGE_INDEX.destinations.map((d) => d.href);
    expect(destinationHrefs).not.toContain("/ask");
    expect(destinationHrefs).not.toContain("/search");
    const navHrefs = APPLICATION_KNOWLEDGE_INDEX.navigation.flatMap((n) =>
      n.type === "link" ? [n.href] : n.children.map((c) => c.href)
    );
    expect(navHrefs).not.toContain("/ask");
    expect(navHrefs).not.toContain("/search");
  });

  it("agrees with the ROUTES table on access, so the two cannot contradict each other", () => {
    for (const u of APPLICATION_KNOWLEDGE_INDEX.globalUtilities) {
      const route = APPLICATION_KNOWLEDGE_INDEX.routes.find((r) => r.path === u.href);
      expect(route?.access, `${u.href} route access`).toBe(u.access);
    }
  });

  it("renders them in the prompt as available everywhere, with their tier", () => {
    const rendered = renderProductKnowledge();
    expect(rendered).toContain("Global utilities");
    expect(rendered).toContain("Ask SecureLogic → /ask");
    expect(rendered).toContain("Search → /search");
    // The tier annotation has to survive the move — an unannotated utility is
    // one the assistant will recommend to a caller who cannot use it.
    expect(rendered).toMatch(/Ask SecureLogic → \/ask.*\[Platform tier\]/);
  });

  it("omits the whole section for a class that can use neither", () => {
    // starter/professional are below platform: no heading promising utilities,
    // and no hrefs.
    for (const cls of ["starter", "professional"] as const) {
      const rendered = renderProductKnowledge(cls);
      expect(rendered, `${cls} names /ask`).not.toContain("/ask");
      expect(rendered, `${cls} names /search`).not.toContain("/search");
      expect(rendered, `${cls} renders an empty utilities heading`).not.toContain(
        "Global utilities"
      );
    }
    expect(renderProductKnowledge("premium")).toContain("Global utilities");
  });
});

/**
 * Access truth (Launch Completion 2) — a body-gated page must never classify
 * `access:"all"` in the index. The scanner cannot see page-body guards, so the
 * declarations in ROUTE_ACCESS_DECLARATIONS / SECONDARY_NAV_ITEMS mirror them;
 * this suite scans the ACTUAL page sources so the mirror cannot silently rot:
 * add a gated page without declaring its access and the build fails here.
 */
describe("access truth — body-gated pages never classify access:'all'", () => {
  // A negated platform/entitlement gate followed by a redirect, or an
  // admin-role redirect. Deliberately narrow: pages that merely MENTION the
  // predicates for conditional rendering (dashboard, briefs) do not match.
  const PLATFORM_GATE = /if \(!isPlatform\w*[^)]*\)/;
  const ADMIN_GATE = /if \(role !== "admin"\)\s*(redirect|{)/;
  const PAID_GATE = /entitlement !== "starter"/;

  const rebuiltAccess = new Map(rebuilt.routes.map((r) => [r.path, r.access]));

  for (const r of scanAppRoutes(appAppDir)) {
    const src = readFileSync(join(appAppDir, r.sourceDir, "page.tsx"), "utf8");
    const platformGated = PLATFORM_GATE.test(src);
    const adminGated = ADMIN_GATE.test(src);
    const paidGated = PAID_GATE.test(src);
    if (!platformGated && !adminGated && !paidGated) continue;

    it(`${r.path} (gated in its page body) is not access:"all"`, () => {
      const access = rebuiltAccess.get(r.path);
      expect(access, `route ${r.path} missing from index`).toBeDefined();
      expect(
        access,
        `${r.path} has a body gate but the index says access:"all" — declare it in ROUTE_ACCESS_DECLARATIONS or SECONDARY_NAV_ITEMS (app/src/lib/navigation.ts)`
      ).not.toBe("all");
    });
  }
});

/**
 * Requester-aware rendering — the prompt for a class must OMIT surfaces that
 * class cannot use, and the unfiltered render must be unchanged (back-compat).
 */
describe("renderProductKnowledge(requesterClass) filters inaccessible surfaces", () => {
  it("starter: no platform- or premium-gated destination or workflow is named", () => {
    const rendered = renderProductKnowledge("starter");
    expect(rendered).not.toContain("/vendors");
    expect(rendered).not.toContain("/findings");
    expect(rendered).not.toContain("/ask");
    expect(rendered).not.toContain("/getting-started");
    expect(rendered).not.toContain("[Platform tier]");
    // The wedge and the account surfaces remain.
    expect(rendered).toContain("/briefs");
    expect(rendered).toContain("/account");
  });

  it("professional: premium destinations render, platform ones do not", () => {
    const rendered = renderProductKnowledge("professional");
    expect(rendered).toContain("/account/team");
    expect(rendered).not.toContain("/vendors");
    expect(rendered).not.toContain("[Platform tier]");
  });

  it("premium: everything renders, identical to the unfiltered corpus", () => {
    expect(renderProductKnowledge("premium")).toBe(renderProductKnowledge());
  });

  it("admin-only settings stay listed (role, not entitlement) with their annotation", () => {
    const rendered = renderProductKnowledge("starter");
    expect(rendered).toContain("Security settings");
    expect(rendered).toContain("[admin only]");
  });
});
