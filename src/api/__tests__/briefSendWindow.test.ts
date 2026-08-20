import { describe, it, expect } from "vitest";
import { isBriefSendDay, currentBriefWeekStart } from "../lib/briefSendWindow.js";

/**
 * Intelligence Brief email delivery runs once a week, on Tuesday (UTC) only.
 * isBriefSendDay() is the single predicate gating the send; these tests pin
 * the Tuesday/other-day boundary so a future edit can't silently widen the
 * send window (e.g. back to weekday or daily).
 *
 * Dates below are chosen for their known UTC weekday. 7:00 AM UTC is used to
 * mirror the cron fire time and confirm the early-UTC-morning boundary lands
 * on the intended weekday.
 */
describe("isBriefSendDay — weekly Tuesday email gate (UTC)", () => {
  it("returns true on Tuesday (sends)", () => {
    // 2026-06-23 is a Tuesday
    expect(isBriefSendDay(new Date("2026-06-23T07:00:00Z"))).toBe(true);
  });

  it("returns false on Monday", () => {
    // 2026-06-22 is a Monday
    expect(isBriefSendDay(new Date("2026-06-22T07:00:00Z"))).toBe(false);
  });

  it("returns false on Wednesday", () => {
    expect(isBriefSendDay(new Date("2026-06-24T07:00:00Z"))).toBe(false);
  });

  it("returns false on Thursday", () => {
    expect(isBriefSendDay(new Date("2026-06-25T07:00:00Z"))).toBe(false);
  });

  it("returns false on Friday", () => {
    expect(isBriefSendDay(new Date("2026-06-26T07:00:00Z"))).toBe(false);
  });

  it("returns false on Saturday", () => {
    // 2026-06-27 is a Saturday
    expect(isBriefSendDay(new Date("2026-06-27T07:00:00Z"))).toBe(false);
  });

  it("returns false on Sunday", () => {
    // 2026-06-28 is a Sunday
    expect(isBriefSendDay(new Date("2026-06-28T07:00:00Z"))).toBe(false);
  });

  it("evaluates the weekday in UTC, not local time", () => {
    // 2026-06-24T02:00:00Z is Wednesday in UTC even though it is still
    // Tuesday evening in US timezones — the gate must follow UTC (the cron's
    // tz), so a Tuesday-evening-US instant must NOT fire.
    expect(isBriefSendDay(new Date("2026-06-24T02:00:00Z"))).toBe(false);
    // …and a Monday-evening-US instant that is already Tuesday in UTC DOES.
    expect(isBriefSendDay(new Date("2026-06-23T02:00:00Z"))).toBe(true);
  });
});

/**
 * currentBriefWeekStart() is the shared idempotency boundary between the
 * scheduler's per-org skip and the catch-up's completeness check: the most
 * recent Tuesday 07:00:00 UTC at or before `now`. These tests pin the
 * boundary — especially the Tuesday pre-07:00 case, where the current edition
 * is still LAST week's because the cron has not fired yet.
 *
 * 2026-07-07 is a Tuesday.
 */
describe("currentBriefWeekStart — weekly edition window boundary (UTC)", () => {
  const THIS_TUESDAY = "2026-07-07T07:00:00.000Z";
  const LAST_TUESDAY = "2026-06-30T07:00:00.000Z";

  it("Tuesday exactly at 07:00:00 UTC starts the NEW window (cron fire instant is inclusive)", () => {
    expect(currentBriefWeekStart(new Date("2026-07-07T07:00:00Z")).toISOString()).toBe(THIS_TUESDAY);
  });

  it("Tuesday after 07:00 UTC is inside this week's window", () => {
    expect(currentBriefWeekStart(new Date("2026-07-07T18:30:00Z")).toISOString()).toBe(THIS_TUESDAY);
  });

  it("Tuesday BEFORE 07:00 UTC still belongs to LAST week's window", () => {
    expect(currentBriefWeekStart(new Date("2026-07-07T06:59:59Z")).toISOString()).toBe(LAST_TUESDAY);
  });

  it("Wednesday through the following Monday stay inside this week's window", () => {
    expect(currentBriefWeekStart(new Date("2026-07-08T00:00:00Z")).toISOString()).toBe(THIS_TUESDAY); // Wed
    expect(currentBriefWeekStart(new Date("2026-07-10T12:00:00Z")).toISOString()).toBe(THIS_TUESDAY); // Fri
    expect(currentBriefWeekStart(new Date("2026-07-13T10:00:00Z")).toISOString()).toBe(THIS_TUESDAY); // Mon
  });

  it("crosses a month boundary correctly", () => {
    // 2026-08-01 is a Saturday; the most recent Tuesday 07:00 is 2026-07-28.
    expect(currentBriefWeekStart(new Date("2026-08-01T12:00:00Z")).toISOString()).toBe("2026-07-28T07:00:00.000Z");
  });
});
