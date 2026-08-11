/**
 * DS-7 guard (#692): the MSSP / multi-org capability claim is structurally
 * false — `users.organization_id` is a single NOT NULL FK and
 * TENANT_ISOLATION_STANDARD §1 forbids multi-org — and was ruled removed from
 * every customer-facing surface (ADR-0006 Ruling 4: MSSP returns only as a
 * chartered future program, never as copy first).
 *
 * This pin fails CI if the claim creeps back into either pricing surface or
 * the contact page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "../../../../..");

const CUSTOMER_FACING = [
  "app/src/app/pricing/page.tsx",
  "website/src/lib/pricing.ts",
  "website/src/app/pricing/page.tsx",
  "website/src/app/contact/page.tsx",
];

describe("no MSSP / multi-org claim on customer-facing surfaces", () => {
  for (const rel of CUSTOMER_FACING) {
    it(`${rel} makes no MSSP or multi-org claim`, () => {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      expect(src).not.toMatch(/mssp/i);
      expect(src).not.toMatch(/multi[- ]org/i);
    });
  }
});
