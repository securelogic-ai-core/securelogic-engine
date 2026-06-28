/**
 * emailCadence.test.ts — source-shape tests for the single-customer-email policy.
 *
 * Product decision (2026-06-24): the Intelligence Brief is the single customer
 * email. The Daily Digest send is off (findings stay in-app, real-time critical
 * alerts only), and the Stripe webhook no longer enrolls payers into the
 * `subscribers` list.
 *
 * Cadence update (2026-06-28, B6): the Brief runs once a week on Tuesday at
 * 07:00 UTC. Generation and email send both run weekly on Tuesday; every other
 * day is excluded at the cron level AND by an in-code guard (isBriefSendDay) so
 * manual/off-schedule runs never email on a non-send day. Signal ingestion (the
 * hourly intelligence worker) is unaffected by this change.
 *
 * These structural assertions guard against regression without a live-server
 * harness (same pattern as stripeWebhookSync.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("Intelligence Brief — weekly (Tuesday) cadence", () => {
  const SOURCE = read("../lib/schedulerRunner.ts");

  it("registers the Brief cron weekly on Tuesday (0 7 * * 2), not daily, not weekday, not Monday-only", () => {
    expect(SOURCE).toMatch(/schedule\(\s*"0 7 \* \* 2"/);
    expect(SOURCE).not.toMatch(/schedule\(\s*"0 7 \* \* \*"/);
    expect(SOURCE).not.toMatch(/schedule\(\s*"0 7 \* \* 1-5"/);
    expect(SOURCE).not.toMatch(/schedule\(\s*"0 7 \* \* 1"/);
  });

  it("logs the weekly Tuesday schedule descriptor", () => {
    expect(SOURCE).toMatch(/schedule:\s*"0 7 \* \* 2 \(UTC\)"/);
    expect(SOURCE).toMatch(/description:\s*"Every Tuesday 7:00 AM UTC"/);
  });
});

describe("Intelligence Brief — off-day email send guard (defense-in-depth)", () => {
  const SOURCE = read("../lib/briefScheduler.ts");

  it("imports the send-day predicate", () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*isBriefSendDay\s*\}\s*from\s*"\.\/briefSendWindow\.js"/
    );
  });

  it("skips the email send (but not generation) on a non-send day", () => {
    // The guard must short-circuit BEFORE sendBrief() and record the skip,
    // while generation (generateAndStoreBrief) still runs above it.
    expect(SOURCE).toMatch(/if \(!isSendDay\) \{[\s\S]*?emails_skipped_off_day\+\+/);
    expect(SOURCE).toMatch(/event:\s*"scheduler_brief_send_skipped_off_day"/);
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
