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
  "vendors.ts": { endpoints: 9, unwrapped: ["/vendors/export.csv"] },
  // 7 since GET /ai-systems/:id/history — asTenant-wrapped like the rest.
  "aiSystems.ts": { endpoints: 7, unwrapped: [] },
  // 7 since GET /controls/:id/history — asTenant-wrapped like the rest.
  "controls.ts": { endpoints: 7, unwrapped: [] },
  // 7 since GET /obligations/:id/history — asTenant-wrapped like the rest.
  "obligations.ts": { endpoints: 7, unwrapped: [] },
  // 6 since POST /actions/:id/unblock — asTenant-wrapped like the rest.
  "actions.ts": { endpoints: 6, unwrapped: [] },
  "aiGovernanceAssessments.ts": { endpoints: 4, unwrapped: [] },
  "controlAssessments.ts": { endpoints: 4, unwrapped: [] },
  "obligationAssessments.ts": { endpoints: 4, unwrapped: [] },
  "governanceReviews.ts": { endpoints: 3, unwrapped: [] },
  "vendorReviews.ts": { endpoints: 4, unwrapped: [] },
  // VA-S4 governed evidence writer: 8 endpoints — link, list links, confirm,
  // detach, establish assurance, withdraw, and the D15 read/write pair. All
  // asTenant-wrapped; the file uses no explicit withTenant at all.
  "evidenceLifecycle.ts": { endpoints: 8, unwrapped: [] }
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
      // The wrap owns the request transaction — no nested withTenant may remain
      // inside a wrapped handler. The ONLY sanctioned use is vendors.ts's
      // documented-exception CSV export (M-1 PR-2): the streaming handler is
      // unwrapped and scopes its SELECT in withTenant instead. Count-pinned so
      // a second use still fails here.
      const withTenantUses = (src.match(/withTenant\(/g) ?? []).length;
      const allowed = file === "vendors.ts" ? 1 : 0; // the export.csv call only
      expect(withTenantUses, `${file}: unexpected withTenant use — nested scopes are forbidden`).toBe(allowed);

      for (const exception of spec.unwrapped) {
        expect(src).toContain(exception);
      }
    });
  }
});
