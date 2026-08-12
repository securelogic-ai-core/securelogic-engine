/**
 * seatRouteCoverage.test.ts — default-deny coverage gate (Phase 3b).
 *
 * Enforces that EVERY entitlement-gated route file is classified in
 * seatRouteClassification.ts. An unclassified file fails here — that is the
 * default-deny guarantee at CI: no route can silently expose Contributor data.
 *
 * Also proves the activation gate: while any file is NEEDS_WIRING, the seat
 * model must not be enabled, and the WIRED files must actually carry the
 * contributor-scope wiring they claim.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import {
  classifyRouteFile,
  isSeatModelActivationReady,
  WIRED_ROUTE_FILES,
  WIRED_SCOPED_ROUTE_FILES,
  WIRED_DENY_ROUTE_FILES,
  NEEDS_WIRING_ROUTE_FILES,
} from "../lib/seatRouteClassification.js";

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes");

function entitlementGatedFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => {
      const src = readFileSync(path.join(ROUTES_DIR, f), "utf8");
      return /requireEntitlement|requirePremiumOrCorePlatform/.test(src);
    });
}

describe("default-deny coverage", () => {
  it("every entitlement-gated route file is classified (no UNCLASSIFIED)", () => {
    const unclassified = entitlementGatedFiles().filter(
      (f) => classifyRouteFile(f) === "UNCLASSIFIED"
    );
    expect(unclassified).toEqual([]);
  });

  it("WIRED_SCOPED files import the contributor-scope helpers", () => {
    for (const f of WIRED_SCOPED_ROUTE_FILES) {
      const src = readFileSync(path.join(ROUTES_DIR, f), "utf8");
      expect(src, `${f} must import contributorScope`).toMatch(/contributorScope/);
    }
  });

  it("every WIRED file carries denyContributor (deny governance/aggregate/create)", () => {
    for (const f of WIRED_ROUTE_FILES) {
      const src = readFileSync(path.join(ROUTES_DIR, f), "utf8");
      expect(src, `${f} must deny contributors on governance routes`).toMatch(/denyContributor/);
    }
  });

  it("WIRED_DENY files deny contributors and do NOT grant scoped access", () => {
    for (const f of WIRED_DENY_ROUTE_FILES) {
      const src = readFileSync(path.join(ROUTES_DIR, f), "utf8");
      expect(src, `${f} must deny contributors`).toMatch(/denyContributor/);
      expect(src, `${f} must not grant scoped contributor reads`).not.toMatch(/ownerCondition/);
    }
  });
});

describe("activation gate", () => {
  it("seat model is NOT activation-ready while families remain unwired", () => {
    // This is the safety interlock: the flag stays OFF until NEEDS_WIRING is
    // empty. When the remaining families are wired, move them to WIRED and this
    // expectation flips to true — a deliberate, reviewed change.
    if (NEEDS_WIRING_ROUTE_FILES.length > 0) {
      expect(isSeatModelActivationReady()).toBe(false);
    } else {
      expect(isSeatModelActivationReady()).toBe(true);
    }
  });

  it("no file is both WIRED and NEEDS_WIRING", () => {
    const overlap = WIRED_ROUTE_FILES.filter((f) => NEEDS_WIRING_ROUTE_FILES.includes(f));
    expect(overlap).toEqual([]);
  });
});
