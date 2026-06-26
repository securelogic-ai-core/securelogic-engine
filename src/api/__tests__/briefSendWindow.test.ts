import { describe, it, expect } from "vitest";
import { isBriefSendDay } from "../lib/briefSendWindow.js";

/**
 * Intelligence Brief email delivery runs Monday-Friday (UTC) only.
 * isBriefSendDay() is the single predicate gating the send; these tests pin
 * the weekday/weekend boundary so a future edit can't silently re-enable
 * weekend emails.
 *
 * Dates below are chosen for their known UTC weekday. 7:00 AM UTC is used to
 * mirror the cron fire time and confirm the early-UTC-morning boundary lands
 * on the intended weekday.
 */
describe("isBriefSendDay — weekday email gate (UTC)", () => {
  it("returns true on Monday (sends)", () => {
    // 2026-06-22 is a Monday
    expect(isBriefSendDay(new Date("2026-06-22T07:00:00Z"))).toBe(true);
  });

  it("returns true on Tuesday", () => {
    expect(isBriefSendDay(new Date("2026-06-23T07:00:00Z"))).toBe(true);
  });

  it("returns true on Wednesday", () => {
    expect(isBriefSendDay(new Date("2026-06-24T07:00:00Z"))).toBe(true);
  });

  it("returns true on Thursday", () => {
    expect(isBriefSendDay(new Date("2026-06-25T07:00:00Z"))).toBe(true);
  });

  it("returns true on Friday (sends)", () => {
    // 2026-06-26 is a Friday
    expect(isBriefSendDay(new Date("2026-06-26T07:00:00Z"))).toBe(true);
  });

  it("returns false on Saturday (skips email send)", () => {
    // 2026-06-27 is a Saturday
    expect(isBriefSendDay(new Date("2026-06-27T07:00:00Z"))).toBe(false);
  });

  it("returns false on Sunday (skips email send)", () => {
    // 2026-06-28 is a Sunday
    expect(isBriefSendDay(new Date("2026-06-28T07:00:00Z"))).toBe(false);
  });

  it("evaluates the weekday in UTC, not local time", () => {
    // 2026-06-27T02:00:00Z is Saturday in UTC even though it is still
    // Friday evening in US timezones — the gate must follow UTC (the cron's tz).
    expect(isBriefSendDay(new Date("2026-06-27T02:00:00Z"))).toBe(false);
  });
});
