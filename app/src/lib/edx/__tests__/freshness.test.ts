/**
 * EDX-8 (date provenance) — window-contradiction decision logic.
 *
 * The contract under test: a contradiction is asserted ONLY from two real
 * dates, only beyond the grace period, and with an age label a reader can
 * repeat out loud ("16 years", "10 months", "45 days").
 */
import { describe, it, expect } from "vitest";
import {
  daysBefore,
  ageLabel,
  windowContradictionAge,
  WINDOW_CONTRADICTION_GRACE_DAYS,
} from "../freshness";

describe("daysBefore", () => {
  it("counts whole UTC days from date to reference", () => {
    expect(daysBefore("2026-05-01", "2026-05-25")).toBe(24);
    expect(daysBefore("2026-05-25", "2026-05-25")).toBe(0);
  });

  it("is null when either side is absent or unparseable — never a guess", () => {
    expect(daysBefore(null, "2026-05-25")).toBeNull();
    expect(daysBefore("2026-05-01", null)).toBeNull();
    expect(daysBefore(undefined, "2026-05-25")).toBeNull();
    expect(daysBefore("not-a-date", "2026-05-25")).toBeNull();
  });
});

describe("ageLabel", () => {
  it("uses years from 365 days, months from 60 days, else days", () => {
    expect(ageLabel(5929)).toBe("16 years");
    expect(ageLabel(365)).toBe("1 year");
    expect(ageLabel(300)).toBe("10 months");
    expect(ageLabel(45)).toBe("45 days");
    expect(ageLabel(59)).toBe("59 days");
  });
});

describe("windowContradictionAge", () => {
  it("flags a source date that predates the window beyond the grace period", () => {
    // CVE-2010-0188-class case: reported 2010, window opens 2026.
    expect(windowContradictionAge("2010-03-01T00:00:00.000Z", "2026-05-25")).toBe(
      "16 years"
    );
  });

  it("stays silent within the window and within the grace period", () => {
    expect(windowContradictionAge("2026-05-28", "2026-05-25")).toBeNull();
    // 24 days before the window start — inside the 30-day grace.
    expect(windowContradictionAge("2026-05-01", "2026-05-25")).toBeNull();
    // Exactly at the grace boundary — still silent (strictly-greater rule).
    const atBoundary = windowContradictionAge(
      "2026-04-25",
      "2026-05-25",
      WINDOW_CONTRADICTION_GRACE_DAYS
    );
    expect(atBoundary).toBeNull();
  });

  it("asserts nothing from absence — null dates never produce a note", () => {
    expect(windowContradictionAge(null, "2026-05-25")).toBeNull();
    expect(windowContradictionAge("2010-03-01", null)).toBeNull();
    expect(windowContradictionAge(undefined, undefined)).toBeNull();
  });
});
