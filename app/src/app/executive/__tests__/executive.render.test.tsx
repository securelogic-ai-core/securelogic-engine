/**
 * /executive — the Executive Risk dashboard's render contract.
 *
 * This page is the leadership view: every number on it is enterprise-wide, and every
 * panel is fed by an engine surface that is independently dark behind its own feature
 * flag. Two defect classes are what this file exists to catch:
 *
 *   1. A dishonest state. Each panel can be (a) on with data, (b) dark (the engine 404s
 *      the feature), or (c) genuinely failing. A leader who is shown a confident zero
 *      for a forecast the platform could not compute makes a decision on a fiction.
 *      "Unavailable" and "clean" must never render the same.
 *   2. A destination that answers a different question than the number asked (#638).
 *      Sweeping every anchor is the only place that is visible — an engine test never
 *      sees an href.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderPage, expectRedirect, signedIn, signedOut, apiKeyOnly, hrefs } from "@/test/harness";
import {
  aConnectorHealth,
  aConnectorHealthEntry,
  aDimensionTrend,
  aHistoryPoint,
  aPostureForecast,
  aPredictiveInsights,
  aPredictiveInsightsResponse,
  aRiskTrends,
} from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getRiskTrends: vi.fn(),
  getPredictiveInsights: vi.fn(),
  getPostureForecast: vi.fn(),
  getConnectorHealth: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import ExecutivePage from "../page";

/** The engine's "this feature is dark for you" shape: a 404 classified as disabled. */
const DARK = { ok: false as const, disabled: true, error: "not_found" };
/** A real failure: the surface exists, the fetch broke. */
const BROKEN = { ok: false as const, disabled: false, error: "network_error" };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getRiskTrends.mockResolvedValue({ ok: true, ...aRiskTrends() });
  api.getPredictiveInsights.mockResolvedValue({ ok: true, ...aPredictiveInsightsResponse() });
  api.getPostureForecast.mockResolvedValue({ ok: true, ...aPostureForecast() });
  api.getConnectorHealth.mockResolvedValue({ ok: true, ...aConnectorHealth() });
});

const renderExec = () => renderPage(ExecutivePage, undefined as never);

/**
 * The KPI card bearing `label` — scoped, because the same words ("Peak risk") also label
 * a row of the comparison table on this page, and the two must be read independently.
 *
 * Returns the card ELEMENT, so a test can ask what it is: a counted tile drills through
 * and is an <a>; a score has no list behind it and stays a <div>.
 */
const kpiCard = (container: HTMLElement, label: string): HTMLElement | null =>
  (Array.from(container.querySelectorAll(".rounded-xl")).find(
    (card) => card.querySelector("p")?.textContent === label
  ) as HTMLElement | undefined) ?? null;

describe("/executive — authorization and entitlement", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(ExecutivePage, undefined as never)).toBe("/login");
  });

  it("never asks the engine for executive data on behalf of a signed-out caller", async () => {
    signedOut();
    await expectRedirect(ExecutivePage, undefined as never);
    expect(api.getRiskTrends).not.toHaveBeenCalled();
    expect(api.getConnectorHealth).not.toHaveBeenCalled();
  });

  it("sends a Brief-tier (unentitled) caller back to /dashboard, and fetches nothing", async () => {
    signedIn({ entitlementLevel: "professional" });

    expect(await expectRedirect(ExecutivePage, undefined as never)).toBe("/dashboard");
    // A redirect that still fetched would leak platform data into a tier that has not
    // bought it — the gate must precede the fetch, not decorate it.
    expect(api.getRiskTrends).not.toHaveBeenCalled();
    expect(api.getPredictiveInsights).not.toHaveBeenCalled();
  });

  it("a caller with no entitlement at all is treated as free, not as platform", async () => {
    signedIn({ entitlementLevel: undefined });
    expect(await expectRedirect(ExecutivePage, undefined as never)).toBe("/dashboard");
  });

  for (const level of ["platform", "premium", "team"] as const) {
    it(`admits a ${level} caller and renders the executive surface`, async () => {
      signedIn({ entitlementLevel: level });
      await renderExec();
      expect(screen.getByText("Executive Risk")).toBeInTheDocument();
    });
  }

  it("an API-key caller carries no entitlement and is sent to /dashboard", async () => {
    // apiKeyOnly() has a token but no entitlementLevel — the page must fall back to
    // "free" rather than assume a machine caller is platform-entitled.
    apiKeyOnly();
    expect(await expectRedirect(ExecutivePage, undefined as never)).toBe("/dashboard");
  });
});

describe("/executive — no enterprise number routes to a user-scoped page", () => {
  it("no anchor anywhere on the page is scoped to the signed-in user", async () => {
    const { container } = await renderExec();

    // Every figure here is org-wide (enterprise risk, fleet health, forecast). A
    // `owner=me` / `view=mine` destination would answer a board-level question with
    // the caller's personal queue.
    for (const href of hrefs(container)) {
      expect(href).not.toContain("owner=me");
      expect(href).not.toContain("view=mine");
      expect(href).not.toContain("mine=true");
    }
  });

  it("every drill-through is org-wide — the enterprise view opens the whole registry", async () => {
    const { container } = await renderExec();

    // The counted figures now open the registry. The enterprise view's scope IS the whole
    // registry, so its destination carries no type filter — but it must still never carry
    // a user filter, which would answer a board question with one person's queue.
    const assetLinks = hrefs(container).filter((h) => h.startsWith("/assets"));
    expect(assetLinks.length).toBeGreaterThan(0);
    for (const href of assetLinks) {
      expect(href).not.toContain("owner=");
      expect(href).not.toContain("view=");
    }
  });
});

describe("/executive — the tiles drill through, and the destination reproduces the number", () => {
  it("a counted tile opens the view that reproduces it; a SCORE opens nothing", async () => {
    const { container } = await renderExec();
    const links = hrefs(container);

    // "Total assets" and "Assets at risk" are populations — each opens the list that
    // holds exactly that population. Before this, the executive dashboard had no
    // drill-through at all: every number a board member saw was a dead end.
    expect(links).toContain("/assets");
    expect(links).toContain("/assets?at_risk=true");

    // "Peak risk" and "Average risk" are SCORES. There is no list of them, so they are
    // deliberately NOT links — pointing them at a list of assets would invent a
    // relationship the number does not have. A plausible destination is still a wrong one.
    expect(kpiCard(container, "Peak risk")?.tagName).toBe("DIV");
    expect(kpiCard(container, "Average risk")?.tagName).toBe("DIV");
    // ...while the counted ones are anchors.
    expect(kpiCard(container, "Total assets")?.tagName).toBe("A");
    expect(kpiCard(container, "Assets at risk")?.tagName).toBe("A");
  });

  it("the drill-through carries the DIMENSION — never an unscoped list", async () => {
    // The arrival-context rule. Selecting the Cloud Resource view and clicking its
    // "Assets at risk" must land on cloud resources at risk — not on every asset in the
    // org, leaving the customer to re-derive the number they just clicked.
    api.getRiskTrends.mockResolvedValue({
      ok: true,
      ...aRiskTrends({
        trends: [
          aDimensionTrend({ dimension: "enterprise" }),
          aDimensionTrend({ dimension: "cloud_resource" }),
        ],
      }),
    });

    const view = await renderExec();

    // fireEvent, not user-event: the harness ships with RTL and this package does not
    // expand the test framework.
    fireEvent.click(screen.getByRole("button", { name: "Cloud Resource" }));

    const { container } = view;
    expect(kpiCard(container, "Assets at risk")).toHaveAttribute(
      "href",
      "/assets?asset_type=cloud_resource&at_risk=true"
    );
    expect(kpiCard(container, "Total assets")).toHaveAttribute(
      "href",
      "/assets?asset_type=cloud_resource"
    );
  });

  it("discloses the snapshot the figures come from, because the destination is live", async () => {
    // These KPIs are a DAILY SNAPSHOT; the registry they open is live. Unstated, the
    // first day's drift makes the tile look broken against its own destination.
    await renderExec();

    expect(screen.getByText(/As of the .* snapshot/)).toBeInTheDocument();
    expect(screen.getByText(/live registry, which may have moved since/)).toBeInTheDocument();
  });
});

describe("/executive — the export link is real, and only offered when the data is", () => {
  it("exposes Export CSV pointing at a route that actually exists", async () => {
    const { container } = await renderExec();

    const href = hrefs(container).find((h) => h.startsWith("/api/export/"));
    expect(href).toBe("/api/export/risk-trends");

    // A dead export link is a broken promise the moment a leader clicks it. Assert the
    // route module backing this href is on disk (the PDF/CSV body itself is out of
    // scope — only that the destination is not a 404).
    const routeDir = join(process.cwd(), "src/app/api/export/risk-trends");
    expect(
      existsSync(join(routeDir, "route.ts")) || existsSync(join(routeDir, "route.tsx"))
    ).toBe(true);
  });

  it("withholds the export when the trends load failed — you cannot export what did not load", async () => {
    api.getRiskTrends.mockResolvedValue(BROKEN);

    const { container } = await renderExec();

    expect(screen.queryByText(/Export CSV/)).toBeNull();
    expect(hrefs(container)).toEqual([]);
  });

  it("withholds the export when risk intelligence is dark for the org", async () => {
    api.getRiskTrends.mockResolvedValue(DARK);

    const { container } = await renderExec();

    expect(hrefs(container)).toEqual([]);
  });
});

describe("/executive — honest unavailable states (never a zeroed dashboard)", () => {
  it("a FAILED trends load says so — it does not render an empty/zeroed executive view", async () => {
    api.getRiskTrends.mockResolvedValue(BROKEN);

    await renderExec();

    expect(screen.getByText(/Could not load this panel \(network_error\)/)).toBeInTheDocument();
    // The zero-risk reading and the "we could not read it" reading must not look alike.
    expect(screen.queryByText("Average risk")).toBeNull();
    expect(screen.queryByText(/No risk history yet/)).toBeNull();
  });

  it("DARK risk intelligence says 'not enabled', which is NOT the same as an error", async () => {
    api.getRiskTrends.mockResolvedValue(DARK);

    await renderExec();

    expect(
      screen.getByText("Risk intelligence is not enabled for your organization yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Could not load this panel/)).toBeNull();
  });

  it("an EMPTY history says the snapshot has not run — not a clean bill of health", async () => {
    api.getRiskTrends.mockResolvedValue({ ok: true, ...aRiskTrends({ trends: [] }) });

    await renderExec();

    expect(
      screen.getByText(
        "No risk history yet. Executive views populate after the daily risk snapshot runs."
      )
    ).toBeInTheDocument();
    // No KPI scorecard of zeros standing in for "we have never measured you".
    expect(screen.queryByText("Assets at risk")).toBeNull();
    expect(screen.queryByText("Peak risk")).toBeNull();
  });

  it("the other panels survive a trends failure — each surface degrades on its own", async () => {
    api.getRiskTrends.mockResolvedValue(BROKEN);

    await renderExec();

    // Predictive and connector health are fetched independently; a dead trends call
    // must not blank the whole leadership view.
    expect(screen.getByText("Predictive intelligence")).toBeInTheDocument();
    expect(screen.getByText("Connector health")).toBeInTheDocument();
    expect(screen.getByText(aPredictiveInsights().headline)).toBeInTheDocument();
    expect(screen.getByText("AWS")).toBeInTheDocument();
  });
});

describe("/executive — predictive: unavailable must not render as a confident zero", () => {
  it("DARK predictive intelligence says so, and prints no forecast number", async () => {
    api.getPredictiveInsights.mockResolvedValue(DARK);

    await renderExec();

    expect(
      screen.getByText("Predictive intelligence is not enabled for your organization yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Recommended actions/)).toBeNull();
    expect(screen.queryByText(/^Posture \(/)).toBeNull();
  });

  it("a FAILED predictive load renders the error, not a blank optimistic panel", async () => {
    api.getPredictiveInsights.mockResolvedValue({ ok: false, disabled: false, error: "upstream_500" });

    await renderExec();

    expect(screen.getByText(/Could not load this panel \(upstream_500\)/)).toBeInTheDocument();
  });

  it("INSUFFICIENT history says there is not enough history — it does not draw a flat zero line", async () => {
    // One observation cannot make a forecast. The panel must say that in words rather
    // than render a sparkline that implies a measured trend.
    api.getPostureForecast.mockResolvedValue({
      ok: true,
      ...aPostureForecast({
        observations: [{ date: "2026-07-01", score: 68 }],
        forecast: null,
      }),
    });

    const { container } = await renderExec();

    expect(
      screen.getByText("Not enough history for a posture forecast yet.")
    ).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Posture score forecast"]')).toBeNull();
  });

  it("null scores are not counted as observations — an unscored day is not a zero", async () => {
    api.getPostureForecast.mockResolvedValue({
      ok: true,
      ...aPostureForecast({
        observations: [
          { date: "2026-06-01", score: 62 },
          { date: "2026-06-15", score: null },
          { date: "2026-07-01", score: null },
        ],
        forecast: null,
      }),
    });

    await renderExec();

    expect(screen.getByText("Not enough history for a posture forecast yet.")).toBeInTheDocument();
  });

  it("a FAILED forecast still shows the insights, and shows no posture projection at all", async () => {
    api.getPostureForecast.mockResolvedValue(BROKEN);

    const { container } = await renderExec();

    // insights.ok && !forecast.ok → the narrative renders, the sparkline is omitted
    // entirely rather than projecting from data the page does not have.
    expect(screen.getByText(aPredictiveInsights().headline)).toBeInTheDocument();
    expect(container.querySelector('svg[aria-label="Posture score forecast"]')).toBeNull();
    expect(screen.queryByText(/Not enough history for a posture forecast/)).toBeNull();
  });

  it("labels a deterministic narrative as deterministic and an LLM narrative as AI-assisted", async () => {
    await renderExec();
    expect(screen.getByText("Deterministic")).toBeInTheDocument();

    api.getPredictiveInsights.mockResolvedValue({
      ok: true,
      ...aPredictiveInsightsResponse({ insights: aPredictiveInsights({ source: "llm" }) }),
    });
    const { container } = await renderExec();
    expect(container.textContent).toContain("AI-assisted");
  });
});

describe("/executive — connector health degrades honestly", () => {
  it("DARK enterprise connectors say 'not enabled', not 'healthy'", async () => {
    api.getConnectorHealth.mockResolvedValue(DARK);

    await renderExec();

    expect(
      screen.getByText("Enterprise connectors is not enabled for your organization yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Fleet status")).toBeNull();
    expect(screen.queryByText("Healthy")).toBeNull();
  });

  it("a FAILED health load renders the error, never an implied-healthy fleet", async () => {
    api.getConnectorHealth.mockResolvedValue(BROKEN);

    await renderExec();

    expect(screen.getByText(/Could not load this panel \(network_error\)/)).toBeInTheDocument();
    expect(screen.queryByText("Fleet status")).toBeNull();
  });

  it("zero CONFIGURED connectors says so, and counts what is available instead", async () => {
    api.getConnectorHealth.mockResolvedValue({
      ok: true,
      ...aConnectorHealth({
        overall_band: "unconfigured",
        connectors: [
          aConnectorHealthEntry({ connector_id: "aws", band: "unconfigured", reasons: [] }),
          aConnectorHealthEntry({ connector_id: "okta", band: "unconfigured", reasons: [] }),
        ],
        by_band: { unconfigured: 2 },
      }),
    });

    await renderExec();

    expect(
      screen.getByText("No connectors configured yet (2 available to connect).")
    ).toBeInTheDocument();
  });
});

describe("/executive — the two-switch flag model", () => {
  it("renders identically whether SECURELOGIC_RISK_INTELLIGENCE_ENABLED is on or off", async () => {
    // The env flag hides the NAV entry only (navigation.ts). The page itself must not
    // read it: a deep-link is gated by the ENGINE (which 404s → DisabledNotice) and by
    // entitlement. If the page ever started branching on the env flag, a half-migrated
    // state would exist where the nav is on and the page is blank, or vice versa.
    vi.stubEnv("SECURELOGIC_RISK_INTELLIGENCE_ENABLED", "false");
    const off = await renderExec();
    const offHtml = off.container.innerHTML;
    const offHrefs = hrefs(off.container);
    off.unmount();

    vi.stubEnv("SECURELOGIC_RISK_INTELLIGENCE_ENABLED", "true");
    const on = await renderExec();

    expect(on.container.innerHTML).toBe(offHtml);
    expect(hrefs(on.container)).toEqual(offHrefs);
    // The drill-throughs and the export — identical under both flag states.
    expect(hrefs(on.container)).toEqual([
      "/api/export/risk-trends",
      "/assets",
      "/assets?at_risk=true",
    ]);
  });

  it("with the env flag OFF, an entitled deep-link still gets the engine's honest state", async () => {
    // Flag OFF app-side + engine dark → the customer must be told the feature is not
    // enabled, not shown an empty dashboard.
    vi.stubEnv("SECURELOGIC_RISK_INTELLIGENCE_ENABLED", "false");
    api.getRiskTrends.mockResolvedValue(DARK);
    api.getPredictiveInsights.mockResolvedValue(DARK);
    api.getConnectorHealth.mockResolvedValue(DARK);

    await renderExec();

    expect(
      screen.getByText("Risk intelligence is not enabled for your organization yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Average risk")).toBeNull();
  });
});

describe("/executive — the numbers on the page reconcile with each other", () => {
  it("the enterprise KPI scorecard reproduces the heatmap's enterprise row", async () => {
    api.getRiskTrends.mockResolvedValue({
      ok: true,
      ...aRiskTrends({
        trends: [
          aDimensionTrend({
            dimension: "enterprise",
            points: [
              aHistoryPoint({ snapshot_date: "2026-04-13", asset_count: 30, at_risk_count: 4, max_risk: 70, avg_risk: 31 }),
              aHistoryPoint({ snapshot_date: "2026-07-01", asset_count: 47, at_risk_count: 13, max_risk: 88, avg_risk: 44 }),
            ],
          }),
        ],
      }),
    });

    const { container } = await renderExec();

    // The KPI tile and the heatmap row describe the SAME population (enterprise, latest
    // snapshot). If they can disagree, one of them is lying to the board.
    const kpi = (label: string) =>
      Array.from(container.querySelectorAll(".rounded-xl"))
        .find((card) => card.querySelector("p")?.textContent === label)
        ?.querySelector("p.text-2xl")?.textContent;
    expect(kpi("Total assets")).toBe("47");
    expect(kpi("Assets at risk")).toBe("13");
    expect(kpi("Peak risk")).toBe("88");
    expect(kpi("Average risk")).toBe("44");

    // The heatmap is the table keyed by "Dimension" (the comparison table is keyed by
    // "Metric" and also lives on this page).
    const heatmap = Array.from(container.querySelectorAll("table")).find((t) =>
      t.querySelector("thead")?.textContent?.includes("Dimension")
    )!;
    const row = heatmap.querySelector("tbody tr") as HTMLElement;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim());
    // Dimension | avg | peak | at-risk | assets | trend
    expect(cells[0]).toContain("Enterprise");
    expect(cells[1]).toBe("44");
    expect(cells[2]).toBe("88");
    expect(cells[3]).toBe("13");
    expect(cells[4]).toBe("47");
  });

  it("the KPI window matches the window the engine actually returned, not a hard-coded 90", async () => {
    api.getRiskTrends.mockResolvedValue({ ok: true, ...aRiskTrends({ window_days: 30 }) });

    const { container } = await renderExec();

    // The delta beneath each KPI is "change over N days". Printing 90d beside a 30d
    // delta mislabels the population the number was computed from.
    expect(container.textContent).toContain("· 30d");
    expect(container.textContent).not.toContain("· 90d");
  });
});
