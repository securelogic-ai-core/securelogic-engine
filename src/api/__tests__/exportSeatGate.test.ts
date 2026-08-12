/**
 * exportSeatGate.test.ts — Phase 6: export is separately permissioned.
 *
 * The export:data capability itself (Full/admin always; Viewer only with the
 * org grant; Contributor never) is proven in seatScopeResolution.test.ts. This
 * locks that every export route actually mounts requireCapability("export:data")
 * so a read-only seat cannot download bulk data.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { resolveScope } from "../lib/seatScope.js";

const ROUTES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes");
const read = (f: string) => readFileSync(path.join(ROUTES, f), "utf8");

const EXPORT_FILES = [
  "findingsExport.ts",
  "risksExport.ts",
  "controlsExport.ts",
  "obligationsExport.ts",
  "aiSystemsExport.ts",
];

describe("export routes require the export:data capability", () => {
  for (const f of EXPORT_FILES) {
    it(`${f} mounts requireCapability("export:data")`, () => {
      expect(read(f)).toMatch(/requireCapability\("export:data"\)/);
    });
  }
  it("GET /risk/export is gated too", () => {
    expect(read("riskIntelligence.ts")).toMatch(/requireSeatCapability\("export:data"\)/);
  });
});

describe("export:data resolution (the capability the gate checks)", () => {
  it("Full governance always has it", () => {
    expect(resolveScope("full", "admin").capabilities.has("export:data")).toBe(true);
    expect(resolveScope("full", "analyst").capabilities.has("export:data")).toBe(true);
  });
  it("a Viewer has it ONLY when the org grants viewer export", () => {
    expect(resolveScope("viewer", "viewer").capabilities.has("export:data")).toBe(false);
    expect(resolveScope("viewer", "viewer", { viewerExportEnabled: true }).capabilities.has("export:data")).toBe(true);
  });
  it("a Contributor never has bulk export", () => {
    expect(resolveScope("contributor", "analyst", { viewerExportEnabled: true }).capabilities.has("export:data")).toBe(false);
  });
});
