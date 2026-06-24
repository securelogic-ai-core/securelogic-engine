/**
 * emailCadence.test.ts — source-shape tests for the single-weekly-email policy.
 *
 * Product decision (2026-06-24): the Intelligence Brief is the single weekly
 * customer email. The Daily Digest send is off (findings stay in-app, real-time
 * critical alerts only), and the Stripe webhook no longer enrolls payers into
 * the `subscribers` list. These structural assertions guard against regression
 * without a live-server harness (same pattern as stripeWebhookSync.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("Intelligence Brief — weekly cadence", () => {
  const SOURCE = read("../lib/schedulerRunner.ts");

  it("registers the Brief cron on Mondays (0 7 * * 1), not daily", () => {
    expect(SOURCE).toMatch(/schedule\(\s*"0 7 \* \* 1"/);
    expect(SOURCE).not.toMatch(/schedule\(\s*"0 7 \* \* \*"/);
  });

  it("logs the weekly schedule descriptor", () => {
    expect(SOURCE).toMatch(/schedule:\s*"0 7 \* \* 1 \(UTC\)"/);
    expect(SOURCE).toMatch(/description:\s*"Every Monday 7:00 AM UTC"/);
  });
});

describe("Daily Digest — send disabled", () => {
  const SOURCE = read("../lib/digestScheduler.ts");

  it("gates runDailyDigest behind the OFF-by-default flag", () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*dailyDigestEnabled\s*\}\s*from\s*"\.\/dailyDigestFeatureFlag\.js"/
    );
    expect(SOURCE).toMatch(
      /if \(!dailyDigestEnabled\(\)\) \{[\s\S]*?event:\s*"daily_digest_disabled"[\s\S]*?return \{ orgsProcessed: 0, emailsSent: 0 \};/
    );
  });
});

describe("Stripe webhook — no Digest/Newsletter list enrollment", () => {
  const SOURCE = read("../webhooks/stripeWebhook.ts");

  it("no longer inserts into the subscribers list", () => {
    expect(SOURCE).not.toMatch(/INSERT INTO subscribers/);
  });

  it("removed the syncSubscriber enrollment helper and its call", () => {
    expect(SOURCE).not.toMatch(/syncSubscriber/);
  });

  it("still enrolls Brief subscribers (intelligence_brief_subscribers) — that path is unchanged", () => {
    expect(SOURCE).toMatch(/INSERT INTO intelligence_brief_subscribers/);
  });
});
