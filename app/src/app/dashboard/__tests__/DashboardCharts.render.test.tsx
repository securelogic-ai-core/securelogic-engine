/**
 * Dashboard tiles — the METRIC CONTRACT, asserted at the tile.
 *
 * A dashboard tile makes two promises at once: the number it prints, and the URL it
 * sends you to when you click it. The promise is kept only when the destination
 * reproduces the number. #638 is the shape of the failure: the tiles were repointed
 * at `?active=true` and CI stayed green because nothing ever rendered a tile and read
 * its href.
 *
 * These are pure presentational components, so they are rendered directly — the tile
 * IS the unit whose contract is under test.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { hrefs, hrefOf } from "@/test/harness";
import { aDashboardSummary, aDomainScore, aFramework, aFrameworkReadiness } from "@/test/fixtures";
import {
  FindingsDonut,
  DomainPostureBars,
  ActionsRing,
  RisksBreakdown,
  RiskHeatmap,
  OpenItemsAging,
  PostureScoreTile,
  ComplianceCoverage,
  FrameworkGaps,
} from "../DashboardCharts";

const SUMMARY = aDashboardSummary();

describe("FindingsDonut — the number, and the URL that must reproduce it", () => {
  it("prints the ACTIVE finding total and links it to the ACTIVE list, never ?status=open", () => {
    // findings.open is the engine's deprecated alias for active_total
    // (open + in_progress). The tile therefore displays the ACTIVE population; a
    // `?status=open` destination would serve a strictly smaller list than the number
    // above it — the customer clicks 8 and counts 5.
    const { container } = render(<FindingsDonut findings={SUMMARY.findings} />);

    expect(screen.getByText("8")).toBeInTheDocument();

    const viewAll = hrefOf(container, /View all active findings/);
    expect(viewAll).toBe("/findings?active=true");

    for (const href of hrefs(container)) {
      expect(href).not.toContain("status=open");
    }
  });

  it("every severity segment carries BOTH the severity and the active filter", () => {
    const { container } = render(<FindingsDonut findings={SUMMARY.findings} />);

    for (const sev of ["Critical", "High", "Moderate", "Low"] as const) {
      const href = hrefOf(container, new RegExp(`^${sev}`));
      // Dropping `active` widens the click-through back to closed findings, so a
      // segment showing 2 lands on a list of 40. Dropping `severity` throws the
      // refinement away entirely. Both params, or the link lies.
      expect(href).toContain(`severity=${sev}`);
      expect(href).toContain("active=true");
      expect(href).toBe(`/findings?severity=${sev}&active=true`);
    }
  });

  it("the severity legend sums to the headline — one tile, one population", () => {
    const { container } = render(<FindingsDonut findings={SUMMARY.findings} />);

    const counts = Array.from(container.querySelectorAll("a[href*='severity=']")).map(
      (a) => Number(a.textContent?.match(/(\d+)\s*$/)?.[1] ?? NaN)
    );
    expect(counts).toEqual([2, 3, 2, 1]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(SUMMARY.findings.open);
  });

  it("a clean org renders zero and still offers the active list (no dead tile)", () => {
    const { container } = render(
      <FindingsDonut
        findings={{ open: 0, by_severity: { Critical: 0, High: 0, Moderate: 0, Low: 0 } }}
      />
    );
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(hrefOf(container, /View all active findings/)).toBe("/findings?active=true");
  });
});

describe("DomainPostureBars — a domain bar is a filter on the ACTIVE population", () => {
  it("links each domain to its findings, url-encoded, with the active filter kept", () => {
    const { container } = render(
      <DomainPostureBars
        domains={[
          aDomainScore({ domain: "Third Party", score: 88 }),
          aDomainScore({ domain: "Cyber", score: 30 }),
        ]}
      />
    );

    expect(hrefOf(container, "Third Party")).toBe("/findings?domain=Third%20Party&active=true");
    expect(hrefOf(container, "Cyber")).toBe("/findings?domain=Cyber&active=true");
  });

  it("shows the empty state rather than a bar chart of nothing", () => {
    const { container } = render(<DomainPostureBars domains={[]} />);
    expect(screen.getByText(/No domain data yet/)).toBeInTheDocument();
    expect(container.querySelector("a[href*='/findings']")).toBeNull();
  });
});

describe("ActionsRing — an org-wide count must land on the org-wide list", () => {
  it("prints ACTIVE work (open+in_progress+blocked) and links it to the matching list", () => {
    const { container } = render(<ActionsRing actions={SUMMARY.actions} />);

    // 4 open + 2 in_progress + 1 blocked = 7 active — the same number the /actions
    // destination shows for ?active=true&view=team.
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(hrefOf(container, /View all open actions/)).toBe("/actions?active=true&view=team");
  });

  it("each status row links to the list filtered to that same status", () => {
    const { container } = render(<ActionsRing actions={SUMMARY.actions} />);

    expect(hrefOf(container, /^Open/)).toBe("/actions?status=open&view=team");
    expect(hrefOf(container, /^In Progress/)).toBe("/actions?status=in_progress&view=team");
    expect(hrefOf(container, /^Blocked/)).toBe("/actions?status=blocked&view=team");
    expect(hrefOf(container, /^Overdue/)).toBe("/actions?overdue=true&view=team");
  });

  it("NO org-wide actions link is scoped to the caller's own work", () => {
    const { container } = render(<ActionsRing actions={SUMMARY.actions} />);

    // The enterprise-wide ring counts everyone's actions. A `view=mine` / `owner=me`
    // destination would answer "7 active" with the caller's own two — the number
    // silently shrinks on click. Every link carries the org-wide scope instead.
    for (const href of hrefs(container)) {
      expect(href).not.toContain("owner=me");
      expect(href).not.toContain("view=mine");
      expect(href).toContain("view=team");
    }
  });

  it("falls back to the parts when an older engine omits `active`", () => {
    const { active: _drop, ...legacy } = SUMMARY.actions;
    render(<ActionsRing actions={legacy} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});

describe("RisksBreakdown — Open Risks", () => {
  it("prints every open risk and links to the list that contains exactly those", () => {
    const { container } = render(<RisksBreakdown risks_summary={SUMMARY.risks_summary} />);

    expect(screen.getByText("6")).toBeInTheDocument();
    expect(hrefOf(container, /View all/)).toBe("/risks?active=true");
    for (const href of hrefs(container)) {
      expect(href).not.toContain("owner=me");
      expect(href).not.toContain("status=open");
    }
  });

  it("shows unscored risks instead of dropping them below the headline", () => {
    render(<RisksBreakdown risks_summary={SUMMARY.risks_summary} />);
    // 1+2+1+1 rated + 1 unscored = 6 = the headline. Hiding Unscored made the bars
    // sum to less than the number printed above them.
    expect(screen.getByText("Unscored")).toBeInTheDocument();
  });
});

describe("OpenItemsAging — the aging buckets belong to the same population as the tiles", () => {
  it("sends Findings to the active list and Actions to the org-wide active list", () => {
    const { container } = render(
      <OpenItemsAging findings={SUMMARY.findings} actions={SUMMARY.actions} />
    );

    expect(hrefOf(container, /View findings/)).toBe("/findings?active=true");
    expect(hrefOf(container, /View actions/)).toBe("/actions?active=true&view=team");
    for (const href of hrefs(container)) {
      expect(href).not.toContain("owner=me");
      expect(href).not.toContain("view=mine");
    }
  });

  it("reports 'all clear' only when BOTH populations are genuinely empty", () => {
    render(
      <OpenItemsAging
        findings={{ open: 0, by_severity: { Critical: 0, High: 0, Moderate: 0, Low: 0 } }}
        actions={{ open: 0, in_progress: 0, blocked: 0, active: 0, overdue: 0 }}
      />
    );
    expect(screen.getByText(/No open items. All clear./)).toBeInTheDocument();
  });

  it("does NOT report 'all clear' when active actions exist but no findings do", () => {
    render(
      <OpenItemsAging
        findings={{ open: 0, by_severity: { Critical: 0, High: 0, Moderate: 0, Low: 0 } }}
        actions={SUMMARY.actions}
      />
    );
    expect(screen.queryByText(/All clear/)).toBeNull();
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });
});

// ── Walkthrough remediation (D-3 / D-5) ─────────────────────────────────────

describe("PostureScoreTile — health-style display (items 1+2 ruling)", () => {
  it("frames the score as HEALTH (higher = better) and NEVER as raw risk-style", () => {
    // The API's canonical mapper serves display values: risk 96 arrives as 4.
    render(
      <PostureScoreTile
        posture={{ overall_score: 4, overall_severity: "Critical", snapshot_date: "2026-07-15" }}
      />,
    );
    expect(screen.getByText(/higher = better/i)).toBeInTheDocument();
    // A Critical posture now reads as a LOW number beside its Critical badge.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    // The app regression the ruling demands: no surface renders raw risk-style.
    expect(screen.queryByText(/higher = more risk/i)).toBeNull();
    expect(screen.queryByText(/\/100 risk/i)).toBeNull();
  });

  it("carries the findings FACT as its own chip, separate from the score badge", () => {
    render(
      <PostureScoreTile
        posture={{ overall_score: 4, overall_severity: "Critical", snapshot_date: "2026-07-15" }}
        findings={{ open: 12, by_severity: { Critical: 2, High: 3, Moderate: 5, Low: 2 } }}
      />,
    );
    const chip = screen.getByText(/2 critical · 3 high findings/);
    expect(chip.closest("a")).toHaveAttribute("href", "/findings?active=true");
  });

  it("formats the DATE-typed snapshot_date in UTC (item 2b — no Jul 14/Jul 15 split)", () => {
    render(
      <PostureScoreTile
        posture={{ overall_score: 50, overall_severity: "Moderate", snapshot_date: "2026-07-15" }}
      />,
    );
    expect(screen.getByText(/as of Jul 15, 2026/)).toBeInTheDocument();
  });
});

describe("DomainPostureBars — health-style (items 1+2 ruling)", () => {
  it("labels the axis higher = better and colors a high display score green", () => {
    const { container } = render(
      <DomainPostureBars
        domains={[aDomainScore({ domain: "Access Control", score: 88, severity: "Low" })]}
      />,
    );
    expect(screen.getByText(/higher = better/i)).toBeInTheDocument();
    // Display 88 (healthy) renders green (rgb form of #22c55e) — under the old
    // risk framing 88 was red.
    expect(container.innerHTML).toContain("rgb(34, 197, 94)");
  });
});

describe("ComplianceCoverage — distinguished from Framework Readiness (D-5)", () => {
  it("explains it is the share of requirements satisfied, not overall readiness", () => {
    render(<ComplianceCoverage frameworkPairs={[]} />);
    expect(screen.getByText(/Share of mapped requirements currently satisfied/i)).toBeInTheDocument();
  });
});

// ── Walkthrough item 7 — framework coverage rule ─────────────────────────────
//
// RULING: satisfied-only score (partial earns NO credit) + the engine's
// explicit caption verbatim + a segmented bar (solid = fully satisfied,
// hatched = partial). The bar and the number must tell the same truth on
// every surface, from ONE shared component.

// The walkthrough's exact case: work exists (3 partial) but none complete —
// score 0, and the caption is what explains the zero.
const ZERO_SCORE_PAIR = {
  framework: aFramework(),
  readiness: aFrameworkReadiness({
    readiness_score: 0,
    total_requirements: 3,
    satisfied: 0,
    partial: 3,
    unmapped: 0,
    coverage_caption: "0 fully satisfied · 3 partial",
  }),
};

describe("FrameworkGaps — coverage caption + segmented bar (item 7)", () => {
  it("renders the engine caption verbatim — '0 fully satisfied' is never dropped", () => {
    render(<FrameworkGaps pairs={[ZERO_SCORE_PAIR]} />);
    // The old breakdown dropped zero counts, so a 0% score sat beside a bare
    // "3 partial" with nothing explaining the zero.
    expect(screen.getByText("0 fully satisfied · 3 partial")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders partials as a distinct hatched segment, no solid segment at score 0", () => {
    const { container } = render(<FrameworkGaps pairs={[ZERO_SCORE_PAIR]} />);
    // Bar and number tell the same truth: no solid (score-credit) segment,
    // but the partial work is VISIBLE as the hatched segment.
    expect(container.querySelector('[data-coverage-segment="satisfied"]')).toBeNull();
    const partialSeg = container.querySelector('[data-coverage-segment="partial"]') as HTMLElement;
    expect(partialSeg).not.toBeNull();
    expect(partialSeg.style.background).toContain("repeating-linear-gradient");
  });

  it("renders both segments when coverage is mixed", () => {
    const { container } = render(
      <FrameworkGaps pairs={[{ framework: aFramework(), readiness: aFrameworkReadiness() }]} />,
    );
    // Fixture: 11 satisfied / 4 partial / 5 unmapped of 20.
    expect(screen.getByText("11 fully satisfied · 4 partial · 5 unmapped")).toBeInTheDocument();
    expect(container.querySelector('[data-coverage-segment="satisfied"]')).not.toBeNull();
    expect(container.querySelector('[data-coverage-segment="partial"]')).not.toBeNull();
  });
});

describe("ComplianceCoverage — coverage caption + segmented bar (item 7)", () => {
  it("renders the engine caption verbatim per framework row", () => {
    render(<ComplianceCoverage frameworkPairs={[ZERO_SCORE_PAIR]} />);
    expect(screen.getByText("0 fully satisfied · 3 partial")).toBeInTheDocument();
  });

  it("says 'fully satisfied' in the aggregate line and segments the row bar", () => {
    const { container } = render(
      <ComplianceCoverage frameworkPairs={[{ framework: aFramework(), readiness: aFrameworkReadiness() }]} />,
    );
    expect(screen.getByText(/11 of 20 requirements fully satisfied/)).toBeInTheDocument();
    const partialSeg = container.querySelector('[data-coverage-segment="partial"]') as HTMLElement;
    expect(partialSeg).not.toBeNull();
    expect(partialSeg.style.background).toContain("repeating-linear-gradient");
  });
});

// ── Walkthrough remediation (items 3 + 10 + 8) ──────────────────────────────

const EMPTY_RISKS_SUMMARY = {
  open: 0,
  by_risk_rating: { Critical: 0, High: 0, Moderate: 0, Low: 0 },
  by_residual_rating: { Critical: 0, High: 0, Moderate: 0, Low: 0 },
  by_residual_likelihood_impact: [],
};

describe("RisksBreakdown + RiskHeatmap — empty register explains itself (items 3+10)", () => {
  it("collapses the all-zero severity ladder into an explanatory empty state", () => {
    const { container } = render(<RisksBreakdown risks_summary={EMPTY_RISKS_SUMMARY} />);
    // The defect: four zero bars implied "measured, found nothing" beside
    // 12 active findings. At zero the ladder must not render at all.
    expect(screen.queryByText("Critical")).toBeNull();
    expect(screen.queryByText("High")).toBeNull();
    expect(screen.getByText(/No risks promoted yet/)).toBeInTheDocument();
    expect(screen.getByText(/don't become risks automatically/)).toBeInTheDocument();
    expect(hrefOf(container, /Review findings/)).toBe("/findings?active=true");
    // The headline 0 stays — it is truthful and reconciles with /risks.
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("keeps the severity ladder when risks exist", () => {
    render(<RisksBreakdown risks_summary={SUMMARY.risks_summary} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByText(/No risks promoted yet/)).toBeNull();
  });

  it("heatmap tells the SAME empty-register story, not 'no data available'", () => {
    const { container } = render(<RiskHeatmap risks_summary={EMPTY_RISKS_SUMMARY} />);
    // "No risk data available." read as a loading/error state and contradicted
    // the adjacent tile's plain 0. Both tiles now share one message and CTA.
    expect(screen.queryByText(/No risk data available/)).toBeNull();
    expect(screen.getByText(/No risks promoted yet/)).toBeInTheDocument();
    expect(hrefOf(container, /Review findings/)).toBe("/findings?active=true");
  });
});

describe("OpenItemsAging — avg age 0 is data, not absence (item 8)", () => {
  it("renders 0 avg days for young actions instead of a dash", () => {
    render(
      <OpenItemsAging
        findings={SUMMARY.findings}
        // 4 active actions all created within the last half day: the engine
        // rounds the average to 0 — a real value the walkthrough saw dashed.
        actions={{
          open: 4, in_progress: 0, blocked: 0, active: 4, overdue: 0,
          avg_age_days: 0, max_age_days: 0, older_than_30: 0, older_than_7: 0,
        }}
      />
    );
    expect(screen.queryByText("—")).toBeNull();
  });

  it("still dashes when there is genuinely nothing to average", () => {
    render(
      <OpenItemsAging
        findings={SUMMARY.findings}
        // No active actions → the engine's AVG over zero rows is null.
        actions={{ open: 0, in_progress: 0, blocked: 0, active: 0, overdue: 0 }}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
