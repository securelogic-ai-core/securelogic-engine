/**
 * IntelligenceBriefDashboardCard — the "Latest Brief" card.
 *
 * Walkthrough item 4 regression: a May-19 brief rendered on a July-15 dashboard
 * with no staleness signal — and the card's own copy ("Today's intelligence" /
 * "Daily Intelligence Brief") actively claimed currency the brief did not have.
 * The cadence is WEEKLY (engine cron "0 7 * * 2"); a Latest Brief older than one
 * cadence window (+grace) must say so.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  IntelligenceBriefDashboardCard,
  briefAgeDays,
  briefAgeLabel,
  BRIEF_STALE_AFTER_DAYS,
} from "../IntelligenceBriefDashboardCard";
import { anIntelligenceBrief, anIntelligenceBriefItem } from "@/test/fixtures";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe("staleness rule (item 4)", () => {
  it("the cadence window is weekly + grace", () => {
    expect(BRIEF_STALE_AFTER_DAYS).toBe(9);
  });

  it("computes whole-day age and a human label", () => {
    expect(briefAgeDays(daysAgo(12), Date.now())).toBe(12);
    expect(briefAgeLabel(12)).toBe("12 days old");
    expect(briefAgeLabel(57)).toBe("8 weeks old"); // the walkthrough's May-19 shape
  });

  it("a brief older than the cadence window renders an explicit staleness indicator", () => {
    const brief = anIntelligenceBrief([anIntelligenceBriefItem()], {
      period_end: daysAgo(57),
    });
    render(<IntelligenceBriefDashboardCard brief={brief} />);
    expect(screen.getByText(/This brief is 8 weeks old/)).toBeInTheDocument();
    expect(screen.getByText(/no newer brief has been published/i)).toBeInTheDocument();
    // A stale brief must not wear an urgency eyebrow as if its actions were current.
    expect(screen.getByText("Older intelligence")).toBeInTheDocument();
    expect(screen.queryByText("Immediate action")).toBeNull();
  });

  it("a fresh brief renders no staleness indicator and keeps its urgency eyebrow", () => {
    const brief = anIntelligenceBrief([anIntelligenceBriefItem({ urgency: "immediate" })], {
      period_end: daysAgo(2),
    });
    render(<IntelligenceBriefDashboardCard brief={brief} />);
    expect(screen.queryByText(/weeks old|days old/)).toBeNull();
    expect(screen.getByText("Immediate action")).toBeInTheDocument();
  });

  it('never claims "Today\'s intelligence" or "Daily" — the cadence is weekly', () => {
    const brief = anIntelligenceBrief(
      [anIntelligenceBriefItem({ urgency: "far_term" })],
      { period_end: daysAgo(1), content_json: { synthesis: null } },
    );
    const { container } = render(<IntelligenceBriefDashboardCard brief={brief} />);
    expect(container.textContent).not.toContain("Today's intelligence");
    expect(container.textContent).not.toContain("Daily Intelligence Brief");
    expect(screen.getByText("Latest intelligence")).toBeInTheDocument();
    expect(screen.getByText("Intelligence Brief")).toBeInTheDocument();
  });
});
