/**
 * PostureTrendChart — health-style display (posture display ruling 2026-07-15).
 *
 * The series arrives HEALTH-style from the API's canonical mapper
 * (src/api/lib/postureDisplay.ts), so an upward line means improving. The chart
 * itself is direction-neutral SVG; what makes the direction legible is the
 * caption. These tests pin the caption and the app-wide regression that no
 * surface renders raw risk-style framing.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PostureSnapshot } from "@/lib/api";
import { PostureTrendChart } from "../PostureTrendChart";

// snapshot_date must fall inside the chart's 90-day window, which is computed
// from the wall clock — so the fixture dates are derived from it too.
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function aSnapshot(overrides: Partial<PostureSnapshot> = {}): PostureSnapshot {
  return {
    id: "snap-1",
    snapshot_date: daysAgo(7),
    overall_score: 62,
    overall_severity: "Moderate",
    open_finding_count: 8,
    open_action_count: 3,
    overdue_action_count: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("PostureTrendChart — health-style caption (items 1+2 ruling)", () => {
  it("labels the series higher = better and never as risk-style", () => {
    const { container } = render(
      <PostureTrendChart
        snapshots={[
          aSnapshot({ id: "s1", snapshot_date: daysAgo(14), overall_score: 40 }),
          aSnapshot({ id: "s2", snapshot_date: daysAgo(7), overall_score: 62 }),
        ]}
      />,
    );
    expect(screen.getByText(/higher = better/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/higher = more risk|\/100 risk/i);
  });

  it("keeps the caption in the single-snapshot state too", () => {
    render(<PostureTrendChart snapshots={[aSnapshot()]} />);
    expect(screen.getByText(/1 snapshot · higher = better/i)).toBeInTheDocument();
  });
});
