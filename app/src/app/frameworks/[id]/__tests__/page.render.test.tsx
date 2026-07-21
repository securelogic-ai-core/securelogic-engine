/**
 * /frameworks/[id] — coverage presentation contract.
 *
 * Same defect class as the frameworks list: the detail page's Compliance
 * Readiness card used a local bar with 75/50/25 color bands and no caption,
 * so its color verdict could contradict the dashboard for the same score and
 * its wording could drift from the ruled caption. It must render the shared
 * CoverageBar + the engine's verbatim coverage_caption, beside the separate
 * (O-5) Assessment Progress card.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn } from "@/test/harness";
import { aFramework, aFrameworkReadiness } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getFrameworkDetail: vi.fn(),
  getFrameworkReadiness: vi.fn(),
  getControls: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import FrameworkDetailPage from "../page";

function renderDetail() {
  return renderPage(FrameworkDetailPage, {
    params: Promise.resolve({ id: "fw-1" }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getFrameworkDetail.mockResolvedValue({
    framework: aFramework({ id: "fw-1", name: "NIST CSF", version: "2.0"  }),
    assessment_progress: {
      self: { total: 4, pass: 1, partial: 1, fail: 1, not_assessed: 1, progress_pct: 75 },
    },
  });
  api.getControls.mockResolvedValue({ controls: [] });
});

describe("/frameworks/[id] — Compliance Readiness card coverage presentation", () => {
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
    const { container } = await renderDetail();

    expect(screen.getByText("Compliance Readiness")).toBeInTheDocument();
    expect(screen.getByText("0 fully satisfied · 3 partial")).toBeInTheDocument();
    expect(container.querySelector('[data-coverage-segment="partial"]')).not.toBeNull();
    expect(container.querySelector('[data-coverage-segment="satisfied"]')).toBeNull();

    // The separate Assessment Progress card (O-5) still renders — the two
    // metrics stay two cards, never blended.
    expect(screen.getByText("Assessment Progress")).toBeInTheDocument();
  });

  it("colors the score with the shared 80/60/40 bands — 77 is amber, matching every other surface", async () => {
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
    await renderDetail();

    const score = screen.getByText("77%");
    // Local 75/50/25 bands painted 77 green; the shared bands say amber.
    expect(score.getAttribute("style")).toContain("rgb(245, 158, 11)");
  });
});
