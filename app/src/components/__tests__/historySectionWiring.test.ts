/**
 * Per-object history wiring — the shared HistorySection (the promoted
 * RR-3 RiskHistorySection) must be mounted on every register detail
 * page whose engine serves /:id/history, each with its own proxy route.
 *
 * Source-text guards (the renewalRow.test.ts pattern): cheap assurance
 * that a page refactor cannot silently drop the audit trail from a
 * register, and that the risks wrapper still delegates to the shared
 * component.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const APP = resolve(__dirname, "../..");

const PAGES: Array<{ page: string; resourcePath: string }> = [
  { page: "app/vendors/[id]/page.tsx", resourcePath: "vendors" },
  { page: "app/controls/[id]/page.tsx", resourcePath: "controls" },
  { page: "app/obligations/[id]/page.tsx", resourcePath: "obligations" },
  { page: "app/ai-systems/[id]/page.tsx", resourcePath: "ai-systems" },
];

describe("HistorySection register wiring", () => {
  for (const { page, resourcePath } of PAGES) {
    it(`${resourcePath} detail page mounts HistorySection with its resource path`, () => {
      const src = readFileSync(resolve(APP, page), "utf8");
      expect(src).toContain('from "@/components/HistorySection"');
      expect(src).toContain(`resourcePath="${resourcePath}"`);
    });
  }

  it("each wired register has a matching Next proxy route", () => {
    for (const { resourcePath } of PAGES) {
      const proxy = readFileSync(
        resolve(APP, `app/api/${resourcePath}/[id]/history/route.ts`),
        "utf8"
      );
      expect(proxy).toContain(`/api/${resourcePath}/`);
      expect(proxy).toContain("/history");
      expect(proxy).toContain("getSession");
    }
  });

  it("RiskHistorySection remains a thin wrapper over the shared component", () => {
    const src = readFileSync(
      resolve(APP, "components/risks/RiskHistorySection.tsx"),
      "utf8"
    );
    expect(src).toContain('from "@/components/HistorySection"');
    expect(src).toContain('resourcePath="risks"');
  });
});
