/**
 * Executive tiles — the label/population contract, asserted at the tile.
 *
 * Every tile on the executive dashboard prints a number under a label. The label is a
 * claim about WHICH population the number counts ("Assets at risk", "Peak risk"), and
 * the tile is honest only when the number is the one that population actually produced
 * — the LATEST snapshot, compared against the WINDOW START, for the SELECTED dimension.
 *
 * These are the failures that survive an engine test: a KPI computed from the wrong end
 * of the series, a comparison that fabricates a delta from a single snapshot, a heatmap
 * that renders a row for a dimension the engine never measured.
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { hrefs } from "@/test/harness";
import {
  aConnectorHealth,
  aConnectorHealthEntry,
  aDimensionTrend,
  aHistoryPoint,
} from "@/test/fixtures";
import { dimensionKpis, dimensionComparison } from "@/lib/executiveRisk";
import { ExecutiveKpiCards } from "../ExecutiveKpiCards";
import { ComparisonPanel } from "../ComparisonPanel";
import { RiskHeatmap } from "../RiskHeatmap";
import { ConnectorHealthPanel } from "../ConnectorHealthPanel";
import { ExecutiveDashboard } from "../ExecutiveDashboard";

/**
 * The value printed on the KPI card whose LABEL is `label` — the customer's own way of
 * reading a scorecard. Scoped to the card, because the same words ("Total assets") also
 * label a row of the comparison table, and the two must be read independently.
 */
const kpiValue = (label: string) =>
  Array.from(document.querySelectorAll(".rounded-xl"))
    .find((card) => card.querySelector("p")?.textContent === label)
    ?.querySelector("p.text-2xl")?.textContent;

describe("ExecutiveKpiCards — each label names the population its number counts", () => {
  const trend = aDimensionTrend({
    points: [
      aHistoryPoint({ snapshot_date: "2026-04-13", asset_count: 30, at_risk_count: 4, max_risk: 70, avg_risk: 31 }),
      aHistoryPoint({ snapshot_date: "2026-05-13", asset_count: 35, at_risk_count: 6, max_risk: 75, avg_risk: 35 }),
      aHistoryPoint({ snapshot_date: "2026-07-01", asset_count: 47, at_risk_count: 13, max_risk: 88, avg_risk: 44 }),
    ],
  });

  it("prints the LATEST snapshot's figures, not the first and not an average of the window", () => {
    render(<ExecutiveKpiCards dimension="enterprise" kpis={dimensionKpis(trend)} windowDays={90} />);

    expect(kpiValue("Total assets")).toBe("47");
    expect(kpiValue("Assets at risk")).toBe("13");
    expect(kpiValue("Peak risk")).toBe("88");
    expect(kpiValue("Average risk")).toBe("44");
  });

  it("the delta beneath each KPI is measured against the WINDOW START, and is labeled with that window", () => {
    const { container } = render(<ExecutiveKpiCards dimension="enterprise" kpis={dimensionKpis(trend)} windowDays={90} />);

    // 47 − 30 = +17 assets; 13 − 4 = +9 at risk. A delta against the *previous* point
    // would print +12 / +7 and quietly under-report the quarter to the board.
    expect(container.textContent).toContain("+17");
    expect(container.textContent).toContain("+9");
    expect(container.textContent).toContain("· 90d");
  });

  it("a rising RISK metric reads as bad, while asset growth stays neutral", () => {
    render(<ExecutiveKpiCards dimension="enterprise" kpis={dimensionKpis(trend)} windowDays={90} />);

    const tone = (label: string) =>
      (
        Array.from(document.querySelectorAll(".rounded-xl"))
          .find((card) => card.querySelector("p")?.textContent === label)!
          .querySelectorAll("p")[2] as HTMLElement
      ).style.color;

    // More assets is not more risk; more at-risk assets is. Colouring them alike would
    // tell a leader that growing the estate is a security regression.
    expect(tone("Assets at risk")).toBe("rgb(252, 165, 165)"); // bad
    expect(tone("Total assets")).toBe("rgb(148, 163, 184)"); // neutral
  });

  it("a single snapshot yields a zero change and says 'No change' — it does not invent a trend", () => {
    const single = aDimensionTrend({
      points: [aHistoryPoint({ asset_count: 5, at_risk_count: 1, max_risk: 40, avg_risk: 20 })],
    });

    const { container } = render(<ExecutiveKpiCards dimension="enterprise" kpis={dimensionKpis(single)} windowDays={90} />);

    expect(kpiValue("Assets at risk")).toBe("1");
    expect(container.textContent).not.toContain("+1");
    expect(screen.getAllByText(/No change/).length).toBe(4);
  });
});

describe("ComparisonPanel — a comparison needs two points to exist", () => {
  it("says there is not enough history rather than comparing a snapshot with itself", () => {
    const single = aDimensionTrend({ points: [aHistoryPoint()] });

    render(<ComparisonPanel comparison={dimensionComparison(single)} windowDays={90} />);

    expect(screen.getByText("Not enough history to compare yet.")).toBeInTheDocument();
    expect(screen.queryByText("Change")).toBeNull();
  });

  it("labels the two columns with the window it actually compared, and reproduces both ends", () => {
    const trend = aDimensionTrend({
      points: [
        aHistoryPoint({ asset_count: 30, at_risk_count: 4, max_risk: 70, avg_risk: 31 }),
        aHistoryPoint({ asset_count: 47, at_risk_count: 13, max_risk: 88, avg_risk: 44 }),
      ],
    });

    const { container } = render(
      <ComparisonPanel comparison={dimensionComparison(trend)} windowDays={90} />
    );

    expect(screen.getByText("90d ago")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();

    const row = (label: string) =>
      Array.from(container.querySelectorAll("tbody tr"))
        .find((tr) => tr.textContent?.startsWith(label))!
        .querySelectorAll("td");

    const atRisk = row("Assets at risk");
    expect(atRisk[1]?.textContent).toBe("4"); // window start
    expect(atRisk[2]?.textContent).toBe("13"); // now
    expect(atRisk[3]?.textContent).toContain("+9"); // and the delta is their difference
  });
});

describe("RiskHeatmap — one row per MEASURED dimension", () => {
  const trends = [
    aDimensionTrend({ dimension: "enterprise" }),
    aDimensionTrend({
      dimension: "cloud",
      direction: "down",
      points: [aHistoryPoint({ asset_count: 12, at_risk_count: 2, max_risk: 55, avg_risk: 26 })],
    }),
  ];

  it("renders a row per dimension with its human label and the current snapshot's figures", () => {
    const { container } = render(<RiskHeatmap trends={trends} />);

    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByText("Cloud")).toBeInTheDocument();

    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);

    const cloud = Array.from(rows[1]!.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cloud[1]).toBe("26"); // avg risk
    expect(cloud[2]).toBe("55"); // peak risk
    expect(cloud[3]).toBe("2"); // at risk
    expect(cloud[4]).toBe("12"); // assets
  });

  it("omits a dimension the engine never measured — no zero row for an unmeasured domain", () => {
    // `current: null` means "no snapshot", not "no risk". A 0/0/0 row would tell a
    // leader the domain is clean when the truth is that it has never been assessed.
    const withUnmeasured = [
      ...trends,
      aDimensionTrend({ dimension: "identity", points: [], current: null }),
    ];

    const { container } = render(<RiskHeatmap trends={withUnmeasured} />);

    expect(container.querySelectorAll("tbody tr").length).toBe(2);
    expect(screen.queryByText("Identity")).toBeNull();
  });

  it("says there is no dimensional data rather than rendering an empty grid", () => {
    render(<RiskHeatmap trends={[aDimensionTrend({ points: [], current: null })]} />);

    expect(screen.getByText("No dimensional risk data yet.")).toBeInTheDocument();
    expect(screen.queryByText("Avg risk")).toBeNull();
  });

  it("carries no user-scoped destination — the heatmap is an enterprise object", () => {
    const { container } = render(<RiskHeatmap trends={trends} />);
    for (const href of hrefs(container)) {
      expect(href).not.toMatch(/owner=me|view=mine|mine=true/);
    }
  });
});

describe("ConnectorHealthPanel — an unhealthy fleet must say why", () => {
  it("shows the worst connector first, with its band and its reason in words", () => {
    const health = aConnectorHealth({
      overall_band: "failing",
      connectors: [
        aConnectorHealthEntry({
          connector_id: "aws",
          display_name: "AWS",
          band: "degraded",
          severity: 2,
          reasons: ["drift_stale_assets"],
        }),
        aConnectorHealthEntry({
          connector_id: "okta",
          display_name: "Okta",
          band: "failing",
          severity: 4,
          reasons: ["repeated_sync_failures", "dead_letters_open"],
          signals: {
            ...aConnectorHealthEntry().signals,
            last_sync_status: "failed",
            consecutive_failures: 3,
            open_dead_letters: 2,
          },
        }),
      ],
    });

    const { container } = render(<ConnectorHealthPanel health={health} />);

    const names = Array.from(container.querySelectorAll("li")).map(
      (li) => li.querySelector("span")?.textContent
    );
    expect(names).toEqual(["Okta", "AWS"]); // worst band first — a leader reads the top

    expect(screen.getByText("Repeated sync failures")).toBeInTheDocument();
    expect(screen.getByText("Open dead-letters")).toBeInTheDocument();
    expect(screen.getByText("Dead-letters: 2")).toBeInTheDocument();
    expect(screen.getByText(/Last sync: failed/)).toBeInTheDocument();
  });

  it("a connector that has never synced says 'never' — not a silent blank", () => {
    const health = aConnectorHealth({
      connectors: [
        aConnectorHealthEntry({
          band: "pending_first_sync",
          reasons: ["never_synced"],
          signals: { ...aConnectorHealthEntry().signals, last_sync_status: null, last_sync_at: null },
        }),
      ],
    });

    render(<ConnectorHealthPanel health={health} />);

    expect(screen.getByText("Last sync: never")).toBeInTheDocument();
    expect(screen.getByText("Never synced")).toBeInTheDocument();
    expect(screen.getByText("Pending first sync")).toBeInTheDocument();
  });
});

describe("ExecutiveDashboard — selecting a view re-scopes every number on it", () => {
  const trends = [
    aDimensionTrend({
      dimension: "enterprise",
      points: [
        aHistoryPoint({ snapshot_date: "2026-04-13", asset_count: 30, at_risk_count: 4, max_risk: 70, avg_risk: 31 }),
        aHistoryPoint({ snapshot_date: "2026-07-01", asset_count: 47, at_risk_count: 13, max_risk: 88, avg_risk: 44 }),
      ],
    }),
    aDimensionTrend({
      dimension: "ai_system",
      direction: "down",
      points: [
        aHistoryPoint({ snapshot_date: "2026-04-13", asset_count: 6, at_risk_count: 3, max_risk: 60, avg_risk: 38 }),
        aHistoryPoint({ snapshot_date: "2026-07-01", asset_count: 9, at_risk_count: 1, max_risk: 52, avg_risk: 22 }),
      ],
    }),
  ];

  const renderDash = () =>
    render(
      <ExecutiveDashboard
        trends={trends}
        windowDays={90}
        predictivePanel={<p>predictive slot</p>}
        healthPanel={<p>health slot</p>}
      />
    );

  it("opens on the enterprise view and prints the ENTERPRISE numbers", () => {
    renderDash();

    expect(kpiValue("Assets at risk")).toBe("13");
    expect(kpiValue("Total assets")).toBe("47");
    expect(screen.getByText("Enterprise trend")).toBeInTheDocument();
  });

  it("clicking the AI System view swaps the KPIs to that dimension's population, not the enterprise's", () => {
    renderDash();

    fireEvent.click(screen.getByRole("button", { name: "Ai System" }));

    // The scorecard, the trend title, and the comparison must move together — a KPI row
    // left on enterprise while the chart says "Ai System" is a mislabeled population.
    expect(kpiValue("Assets at risk")).toBe("1");
    expect(kpiValue("Total assets")).toBe("9");
    expect(screen.getByText("Ai System trend")).toBeInTheDocument();
    expect(screen.getByText("Ai System comparison")).toBeInTheDocument();
  });

  it("clicking a heatmap ROW drills into the same view the selector would", () => {
    const { container } = renderDash();

    const aiRow = Array.from(container.querySelectorAll("tbody tr")).find((tr) =>
      tr.textContent?.includes("Ai System")
    )!;
    fireEvent.click(aiRow);

    expect(screen.getByText("Ai System trend")).toBeInTheDocument();
    expect(kpiValue("Assets at risk")).toBe("1");
  });

  it("the rising-dimension count states the truth about the whole portfolio, not the selected view", () => {
    renderDash();

    // enterprise is up, ai_system is down → exactly one rising.
    expect(screen.getByText("1 dimension rising overall")).toBeInTheDocument();
  });

  it("with no measured dimension at all it says the snapshot has not run — no zeroed scorecard", () => {
    render(
      <ExecutiveDashboard
        trends={[aDimensionTrend({ dimension: "enterprise", points: [], current: null })]}
        windowDays={90}
        predictivePanel={<p>predictive slot</p>}
        healthPanel={<p>health slot</p>}
      />
    );

    expect(
      screen.getByText(
        "No risk history yet. Executive views populate after the daily risk snapshot runs."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Assets at risk")).toBeNull();
  });

  it("the dashboard offers no destination that is scoped to the caller", () => {
    const { container } = renderDash();
    for (const href of hrefs(container)) {
      expect(href).not.toMatch(/owner=me|view=mine|mine=true/);
    }
  });
});
