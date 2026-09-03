/**
 * isolationSuitesUseRealGate.test.ts — the lint VA-Q0 §14 promised.
 *
 * VA-E2E-1 found ~900 lines of portal upload coverage that passed while
 * production 415'd, because the suites assembled their app from buildRoutes()
 * alone and the strict Content-Type gate lives in createApp(). The rule since:
 * a suite that drives a PORTAL or UPLOAD path through supertest must put
 * enforceJsonContentType in front, in the position createApp() puts it.
 *
 * This test turns that rule into a build failure. It scans the isolation
 * suites, finds every file that both (a) builds an express app with
 * buildRoutes() and (b) exercises a vendor-portal, upload, or multipart path,
 * and requires enforceJsonContentType to be wired. Suites that only use raw
 * SQL, or only internal JSON routes, are exempt — the gate is JSON-only there
 * and the defect class cannot occur.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ISOLATION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/isolation");

const PORTAL_OR_UPLOAD = /vendor-portal|\.attach\(|multipart|\/api\/evidence\/upload|vendor-assurance\/documents/;

describe("isolation suites that drive portal or upload paths run behind the real Content-Type gate", () => {
  const offenders: string[] = [];
  const covered: string[] = [];

  for (const f of readdirSync(ISOLATION_DIR).filter((n) => n.endsWith(".test.ts"))) {
    const src = readFileSync(resolve(ISOLATION_DIR, f), "utf8");
    const buildsApp = /buildRoutes\(/.test(src) && /express\(\)/.test(src);
    if (!buildsApp) continue;
    if (!PORTAL_OR_UPLOAD.test(src)) continue;
    if (/enforceJsonContentType/.test(src)) covered.push(f);
    else offenders.push(f);
  }

  it("every such suite wires enforceJsonContentType (no suite is blind to the gate)", () => {
    expect(offenders, `add app.use(enforceJsonContentType) before express.json() in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the rule is not vacuous — the known portal suites are among those checked", () => {
    expect(covered).toEqual(
      expect.arrayContaining([
        "vendorPortalAdversarial.test.ts",
        "vendorPortalUploadAdversarial.test.ts",
        "questionnaireVersionAddressing.test.ts",
      ])
    );
  });
});
