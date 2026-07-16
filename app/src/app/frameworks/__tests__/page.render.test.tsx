/**
 * /frameworks — coverage presentation contract.
 *
 * The defect this file pins (walkthrough follow-up to item 7): the frameworks
 * list re-derived readiness presentation locally — its own bar, its own
 * 75/50/25 color bands, its own breakdown wording — so a score of 77 rendered
 * GREEN here and AMBER on the dashboard, and the caption could drift from the
 * ruled "N fully satisfied · N partial · N unmapped" form. Every readiness
 * surface must use the shared CoverageBar + the engine's verbatim
 * coverage_caption.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn } from "@/test/harness";
import { aFramework, aFrameworkReadiness } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getFrameworks: vi.fn(),
  getFrameworkReadiness: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import FrameworksPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getFrameworks.mockResolvedValue({
    frameworks: [aFramework({ id: "fw-1", name: "NIST CSF", version: "2.0"  })],
  });
});

describe("/frameworks — active framework card coverage presentation", () => {
  it("renders the engine's coverage caption verbatim with the shared segmented bar", async () => {
    api.getFrameworkReadiness.mockResolvedValue(
      aFrameworkReadiness({
        readiness_score: 0,
        total_requirements: 3,
        satisfied: 0,
        partial: 3,
        unmapped: 0,
        coverage_caption: "0 fully satisfied · 3 partial",
      })
    );
    const { container } = await renderPage(FrameworksPage, {});

    // Caption is the engine's, verbatim — never re-derived per surface.
    expect(screen.getByText("0 fully satisfied · 3 partial")).toBeInTheDocument();

    // Shared CoverageBar: at score 0 with partials, a hatched partial segment
    // and NO solid satisfied segment.
    expect(container.querySelector('[data-coverage-segment="partial"]')).not.toBeNull();
    expect(container.querySelector('[data-coverage-segment="satisfied"]')).toBeNull();
  });

  it("colors the score with the shared 80/60/40 bands — 77 is amber here exactly as on the dashboard", async () => {
    api.getFrameworkReadiness.mockResolvedValue(
      aFrameworkReadiness({
        readiness_score: 77,
        total_requirements: 100,
        satisfied: 77,
        partial: 10,
        unmapped: 13,
        coverage_caption: "77 fully satisfied · 10 partial · 13 unmapped",
      })
    );
    await renderPage(FrameworksPage, {});

    const score = screen.getByText("77%");
    // The old local ReadinessBar banded at 75/50/25 and would paint 77 GREEN
    // (#22c55e) while the dashboard's shared bands paint it amber (#f59e0b) —
    // the same number carried two contradictory verdicts.
    expect(score.getAttribute("style")).toContain("rgb(245, 158, 11)");
  });
});
