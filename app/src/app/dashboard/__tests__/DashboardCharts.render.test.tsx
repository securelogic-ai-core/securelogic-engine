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
import { aDashboardSummary, aDomainScore } from "@/test/fixtures";
import {
  FindingsDonut,
  DomainPostureBars,
  ActionsRing,
  RisksBreakdown,
  OpenItemsAging,
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

    const viewAll = hrefOf(container, /View all open findings/);
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
    expect(hrefOf(container, /View all open findings/)).toBe("/findings?active=true");
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
