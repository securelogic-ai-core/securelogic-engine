/**
 * briefSchedulerFeedHealthWiring.test.ts — Verifies the registry-feed batches
 * (threat_intel_rss, regulatory) record PER-FEED health, not just an aggregate.
 *
 * The bug this guards against: `fetchAllFeeds` isolates per-source failures and
 * still returns the surviving feeds' signals, so a single dead registry feed
 * (e.g. ftc_news) never throws at the batch level. The scheduler therefore ran
 * the aggregate `recordFeedSuccess("regulatory", …)` and only *logged* the
 * per-source error — so that one feed never accrued `consecutive_failures` and
 * never tripped the `feed_source_down` alert. That is precisely the silent-rot
 * failure mode feed_health exists to catch, left open for the registry feeds.
 *
 * The fix records `recordFeedSuccess(src, r.mapped)` / `recordFeedFailure(src,
 * r.error)` for every entry of the per-source `results` map, keyed by the
 * individual feed id, IN ADDITION to the aggregate roll-up row.
 *
 * Like briefSchedulerMitreWiring.test.ts, this asserts on the scheduler source
 * text rather than mocking the whole per-org loop — surgical coverage of the
 * wiring that actually matters (per-feed record calls present in both loops),
 * without the mocking surface area.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schedulerSourcePath = path.resolve(here, "../lib/briefScheduler.ts");
const schedulerSource = readFileSync(schedulerSourcePath, "utf8");

describe("briefScheduler.ts source — per-feed health for registry batches", () => {
  it("threat_intel_rss loop records per-feed failure on the error branch", () => {
    expect(schedulerSource).toMatch(
      /recordFeedFailure\(src, r\.error\)[\s\S]*?scheduler_threat_rss_source_failed/
    );
  });

  it("threat_intel_rss loop records per-feed success on the else branch", () => {
    expect(schedulerSource).toMatch(
      /recordFeedSuccess\(src, r\.mapped\)[\s\S]*?scheduler_threat_rss_source_fetched/
    );
  });

  it("regulatory loop records per-feed failure on the error branch", () => {
    expect(schedulerSource).toMatch(
      /recordFeedFailure\(src, r\.error\)[\s\S]*?scheduler_regulatory_source_failed/
    );
  });

  it("regulatory loop records per-feed success on the else branch", () => {
    expect(schedulerSource).toMatch(
      /recordFeedSuccess\(src, r\.mapped\)[\s\S]*?scheduler_regulatory_source_fetched/
    );
  });

  it("keeps the aggregate roll-up rows (per-feed recording is additive, not a replacement)", () => {
    expect(schedulerSource).toMatch(/recordFeedSuccess\("threat_intel_rss",/);
    expect(schedulerSource).toMatch(/recordFeedSuccess\("regulatory",/);
  });

  it("records per-feed failure exactly twice (once per registry batch loop)", () => {
    const matches = schedulerSource.match(/recordFeedFailure\(src, r\.error\)/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});
