/**
 * tenantWrapCoverage.test.ts — EAR P8 (Track A): source-asserts that every
 * endpoint in the ten wrapped core-domain route files registers its handler
 * through asTenant(), so a future endpoint added without the wrap fails CI
 * here instead of silently running off the tenant channel.
 *
 * Documented exception: GET /vendors/export.csv streams (setHeader/write/end)
 * — the asTenant buffering proxy supports exactly one status()+json(), so it
 * stays unwrapped by design (its handler keeps explicit org predicates).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const WRAPPED_FILES: Record<string, { endpoints: number; unwrapped: string[] }> = {
  "vendors.ts": { endpoints: 8, unwrapped: ["/vendors/export.csv"] },
  // 6 since GET /ai-systems/:id/findings — asTenant-wrapped like the rest.
  "aiSystems.ts": { endpoints: 6, unwrapped: [] },
  "controls.ts": { endpoints: 5, unwrapped: [] },
  "obligations.ts": { endpoints: 5, unwrapped: [] },
  "actions.ts": { endpoints: 5, unwrapped: [] },
  "aiGovernanceAssessments.ts": { endpoints: 4, unwrapped: [] },
  "controlAssessments.ts": { endpoints: 4, unwrapped: [] },
  "obligationAssessments.ts": { endpoints: 4, unwrapped: [] },
  "governanceReviews.ts": { endpoints: 3, unwrapped: [] },
  "vendorReviews.ts": { endpoints: 4, unwrapped: [] }
};

describe("EAR P8 — asTenant wrap coverage", () => {
  for (const [file, spec] of Object.entries(WRAPPED_FILES)) {
    it(`${file}: every endpoint except documented exceptions is asTenant-wrapped`, () => {
      const src = readFileSync(path.resolve(HERE, "../routes", file), "utf8");

      const registrations = src.match(/router\.(get|post|patch|put|delete)\(/g) ?? [];
      expect(registrations.length, `${file} endpoint count drifted — update this test AND wrap the new endpoint`).toBe(spec.endpoints);

      const wrapped = src.match(/asTenant\(async \(req, res\) => \{/g) ?? [];
      expect(wrapped.length).toBe(spec.endpoints - spec.unwrapped.length);

      expect(src).toContain('import { asTenant } from "../middleware/asTenant.js";');
      // The wrap owns the request transaction — no nested withTenant may remain.
      expect(src, `${file} must not nest withTenant inside asTenant`).not.toContain("withTenant(");

      for (const exception of spec.unwrapped) {
        expect(src).toContain(exception);
      }
    });
  }
});
