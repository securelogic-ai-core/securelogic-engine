import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS } from "../../../app/src/lib/navigation.js";
import { scanAppRoutes } from "../../../scripts/lib/scanAppRoutes.js";
import {
  buildApplicationKnowledgeIndex,
  type NavInputItem,
} from "../lib/applicationKnowledgeIndex.js";
import { APPLICATION_KNOWLEDGE_INDEX } from "../lib/applicationKnowledgeIndex.generated.js";
import { renderProductKnowledge } from "../lib/productKnowledge.js";

const here = dirname(fileURLToPath(import.meta.url));
const appAppDir = join(here, "..", "..", "..", "app", "src", "app");

// Rebuild the index from the live sources exactly as the generator does.
const rebuilt = buildApplicationKnowledgeIndex(
  NAV_ITEMS as NavInputItem[],
  scanAppRoutes(appAppDir)
);

const routePaths = new Set(APPLICATION_KNOWLEDGE_INDEX.routes.map((r) => r.path));

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
});
