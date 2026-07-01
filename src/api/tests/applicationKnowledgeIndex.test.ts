import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS, SECONDARY_NAV_ITEMS } from "../../../app/src/lib/navigation.js";
import { scanAppRoutes } from "../../../scripts/lib/scanAppRoutes.js";
import {
  buildApplicationKnowledgeIndex,
  type NavInputItem,
  type SecondaryNavInputItem,
} from "../lib/applicationKnowledgeIndex.js";
import { APPLICATION_KNOWLEDGE_INDEX } from "../lib/applicationKnowledgeIndex.generated.js";
import { renderProductKnowledge } from "../lib/productKnowledge.js";

const here = dirname(fileURLToPath(import.meta.url));
const appAppDir = join(here, "..", "..", "..", "app", "src", "app");

// Rebuild the index from the live sources exactly as the generator does.
const rebuilt = buildApplicationKnowledgeIndex(
  NAV_ITEMS as NavInputItem[],
  scanAppRoutes(appAppDir),
  SECONDARY_NAV_ITEMS as SecondaryNavInputItem[]
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

  it("carries entitlement: Ask is Platform-tier, Dashboard is open", () => {
    const ask = APPLICATION_KNOWLEDGE_INDEX.destinations.find((d) => d.href === "/ask");
    const dash = APPLICATION_KNOWLEDGE_INDEX.destinations.find((d) => d.href === "/dashboard");
    expect(ask?.access).toBe("platform");
    expect(dash?.access).toBe("all");
  });

  it("child routes inherit access from their parent menu destination (e.g. /vendors/new = platform)", () => {
    const r = APPLICATION_KNOWLEDGE_INDEX.routes.find((x) => x.path === "/vendors/new");
    expect(r?.access).toBe("platform");
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
