/**
 * briefSchedulerPersonalizationWiring.test.ts — IQ-1 B2: the scheduler path
 * personalizes briefs exactly like the manual route.
 *
 * The bug this guards against: personalizeBriefItems was called ONLY by
 * POST /api/intelligence-briefs/generate (the manual route). The cron
 * scheduler — the path that produces every customer's weekly brief — never
 * imported it and persisted a 17-column insert without is_personalized /
 * platform_context, so every scheduled brief shipped with personalization
 * dark and the "affects your environment" surfaces had nothing to render.
 * Staging evidence (2026-08-07, [SEED] Walkthrough Org): briefs of Aug 2 and
 * Aug 4 carried a Cisco item (CVE-2026-20316) while the org's vendor registry
 * contains Cisco — is_personalized was false on 24/24 items.
 *
 * Like briefSchedulerFeedHealthWiring.test.ts, this asserts on the scheduler
 * source text — surgical coverage of the wiring without mocking the whole
 * generation loop. The personalization LOGIC itself is covered by
 * briefPersonalizationService's own suite; the route/scheduler parity of the
 * PERSISTED columns is what this file pins.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schedulerSource = readFileSync(
  path.resolve(here, "../lib/briefScheduler.ts"),
  "utf8"
);
const routeSource = readFileSync(
  path.resolve(here, "../routes/intelligenceBriefs.ts"),
  "utf8"
);

describe("briefScheduler.ts source — personalization parity with the manual route", () => {
  it("imports and calls personalizeBriefItems on the capped items", () => {
    expect(schedulerSource).toMatch(
      /import \{ personalizeBriefItems \} from "\.\/briefPersonalizationService\.js"/
    );
    expect(schedulerSource).toMatch(
      /personalizedItems = await personalizeBriefItems\(cappedItems, orgId\)/
    );
  });

  it("personalizes BEFORE synthesis and finalization, matching the route's ordering", () => {
    const personalizeAt = schedulerSource.indexOf(
      "personalizedItems = await personalizeBriefItems"
    );
    const synthesisAt = schedulerSource.indexOf(
      "runSynthesisSafely(personalizedItems"
    );
    const finalizeAt = schedulerSource.indexOf("finalizeBrief(\n    personalizedItems");
    expect(personalizeAt).toBeGreaterThan(-1);
    expect(synthesisAt).toBeGreaterThan(personalizeAt);
    expect(finalizeAt).toBeGreaterThan(personalizeAt);
  });

  it("personalization failure is non-fatal and falls back to explicit FALSE/NULL, like the route", () => {
    expect(schedulerSource).toMatch(/brief_personalization_failed/);
    expect(schedulerSource).toMatch(
      /is_personalized: false,\s*\n\s*platform_context: null/
    );
  });

  it("persists the 19-column insert including is_personalized and platform_context", () => {
    expect(schedulerSource).toMatch(/const b = idx \* 19/);
    expect(schedulerSource).toMatch(
      /analyst_notes,\s*\n\s*is_personalized, platform_context,\s*\n\s*urgency\)/
    );
    expect(schedulerSource).toMatch(
      /item\.platform_context \? JSON\.stringify\(item\.platform_context\) : null/
    );
  });

  it("scheduler and route insert the same intelligence_brief_items column list", () => {
    const columns = (src: string): string | null => {
      const m = src.match(
        /INSERT INTO intelligence_brief_items\s*\(([^)]+)\)/
      );
      return m ? m[1]!.replace(/\s+/g, " ").trim() : null;
    };
    const schedulerCols = columns(schedulerSource);
    const routeCols = columns(routeSource);
    expect(schedulerCols).not.toBeNull();
    expect(schedulerCols).toBe(routeCols);
  });
});
