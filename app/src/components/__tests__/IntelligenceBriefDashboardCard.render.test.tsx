/**
 * IntelligenceBriefDashboardCard — staleness rule (walkthrough item 4).
 *
 * The defect: a May-19 brief rendered on July 15 with the "Today's
 * intelligence" eyebrow and its urgency accent — old intelligence silently
 * presenting as current. Product rule: the brief cadence is weekly (Tuesday
 * 07:00 UTC), so a Latest Brief older than one cadence window (+1 day publish
 * slack) must carry an explicit staleness indicator and must NOT claim
 * currency or urgency.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { anIntelligenceBrief, anIntelligenceBriefItem } from "@/test/fixtures";
import { IntelligenceBriefDashboardCard } from "../IntelligenceBriefDashboardCard";

// The walkthrough's clock: brief period_end 2026-05-19, viewed 2026-07-15.
const WALKTHROUGH_TODAY = new Date("2026-07-15T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(WALKTHROUGH_TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IntelligenceBriefDashboardCard — staleness (item 4)", () => {
  it("a brief older than the weekly cadence window declares its age", () => {
    render(
      <IntelligenceBriefDashboardCard
        brief={anIntelligenceBrief([anIntelligenceBriefItem()], {
          period_start: "2026-05-12",
          period_end: "2026-05-19",
        })}
      />
    );
    // 57 days old → floor(57/7) = 8 weeks.
    expect(screen.getByText(/This brief is 8 weeks old/)).toBeInTheDocument();
    expect(screen.getByText(/briefs are published weekly/i)).toBeInTheDocument();
    expect(screen.getByText("Previous brief")).toBeInTheDocument();
  });

  it("a stale brief never carries an urgency or currency eyebrow", () => {
    render(
      <IntelligenceBriefDashboardCard
        brief={anIntelligenceBrief(
          // An immediate-urgency item: the red "Immediate action" accent is
          // itself a false claim when the brief is 8 weeks old.
          [anIntelligenceBriefItem({ urgency: "immediate" })],
          { period_start: "2026-05-12", period_end: "2026-05-19" }
        )}
      />
    );
    expect(screen.queryByText("Immediate action")).toBeNull();
    expect(screen.queryByText(/Today's intelligence/)).toBeNull();
    expect(screen.queryByText(/Current intelligence/)).toBeNull();
  });

  it("a brief within the cadence window keeps its urgency accent and no warning", () => {
    render(
      <IntelligenceBriefDashboardCard
        brief={anIntelligenceBrief([anIntelligenceBriefItem({ urgency: "immediate" })], {
          period_start: "2026-07-07",
          period_end: "2026-07-14", // yesterday
        })}
      />
    );
    expect(screen.getByText("Immediate action")).toBeInTheDocument();
    expect(screen.queryByText(/weeks old|days old/)).toBeNull();
  });

  it("boundary: 8 days is still current, 9 days is stale", () => {
    const { unmount } = render(
      <IntelligenceBriefDashboardCard
        brief={anIntelligenceBrief([anIntelligenceBriefItem()], { period_end: "2026-07-07" })}
      />
    );
    expect(screen.queryByText(/old — briefs are published weekly/)).toBeNull();
    unmount();

    render(
      <IntelligenceBriefDashboardCard
        brief={anIntelligenceBrief([anIntelligenceBriefItem()], { period_end: "2026-07-06" })}
      />
    );
    expect(screen.getByText(/This brief is 9 days old/)).toBeInTheDocument();
  });

  it("formats the DATE-typed period_end pinned to UTC (item 2b rule)", () => {
    render(
      <IntelligenceBriefDashboardCard
        brief={anIntelligenceBrief([anIntelligenceBriefItem()], { period_end: "2026-05-19" })}
      />
    );
    // Without the UTC pin this renders "May 18" in negative-UTC zones.
    expect(screen.getByText(/May 19, 2026/)).toBeInTheDocument();
  });
});
