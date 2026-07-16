/**
 * FrameworkCoverage — the ONE shared coverage rule (walkthrough item 7 ruling).
 *
 * The observed defect: NIST CSF rendered "0%" beside an orphan "3 partial" label
 * because scoring is satisfied-only and no surface explained or visualized the
 * partial effort. The ruling: keep the satisfied-only math, caption every
 * surface, and render partials as a visually distinct bar segment — defined
 * once, so caption and segmentation cannot drift per-surface.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  coveragePct,
  coverageCaption,
  coverageColor,
  CoverageBar,
} from "../FrameworkCoverage";

describe("coveragePct — mirrors the engine's satisfied-only readiness_score", () => {
  it("gives partial NO score credit (the ruling)", () => {
    // The walkthrough shape: 0 satisfied, 3 partial, 57 requirements → 0%.
    expect(coveragePct(0, 57)).toBe(0);
    expect(coveragePct(10, 20)).toBe(50);
    expect(coveragePct(0, 0)).toBe(0);
  });
});

describe("coverageCaption — a zero never reads as zero-effort", () => {
  it("always names satisfied AND partial, even at zero", () => {
    expect(coverageCaption(0, 3)).toBe("0 fully satisfied · 3 partial");
    expect(coverageCaption(5, 0)).toBe("5 fully satisfied · 0 partial");
  });

  it("includes unmapped only when present", () => {
    expect(coverageCaption(0, 3, 54)).toBe("0 fully satisfied · 3 partial · 54 unmapped");
    expect(coverageCaption(0, 3, 0)).toBe("0 fully satisfied · 3 partial");
  });
});

describe("CoverageBar — the bar shows the same truth as the number", () => {
  it("renders a distinct hatched partial segment beside the solid satisfied one", () => {
    const { container } = render(<CoverageBar satisfied={10} partial={5} total={20} />);
    const partialSeg = container.querySelector('[data-segment="partial"]') as HTMLElement;
    expect(partialSeg).not.toBeNull();
    // Hatched, not a solid fill — visually distinct by construction.
    expect(partialSeg.style.background).toContain("repeating-linear-gradient");
    expect(partialSeg.style.width).toBe("25%");
  });

  it("the walkthrough shape (0 satisfied, 3 partial) shows ONLY the partial segment", () => {
    const { container } = render(<CoverageBar satisfied={0} partial={3} total={57} />);
    expect(container.querySelector('[data-segment="partial"]')).not.toBeNull();
    // No solid satisfied segment at zero — the visible effort is all hatch.
    const track = container.firstChild as HTMLElement;
    expect(track.children.length).toBe(1);
  });

  it("clamps so the segments can never overflow the track", () => {
    const { container } = render(<CoverageBar satisfied={30} partial={30} total={20} />);
    const track = container.firstChild as HTMLElement;
    const widths = Array.from(track.children).map((c) =>
      parseFloat((c as HTMLElement).style.width),
    );
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100);
  });

  it("exposes the caption to assistive tech", () => {
    const { container } = render(<CoverageBar satisfied={0} partial={3} total={57} />);
    expect((container.firstChild as HTMLElement).getAttribute("aria-label")).toBe(
      "0 fully satisfied · 3 partial",
    );
  });
});

describe("coverageColor — one band across every surface", () => {
  it("uses the canonical 80/60/40 posture-style bands", () => {
    expect(coverageColor(85)).toBe("#22c55e");
    expect(coverageColor(65)).toBe("#f59e0b");
    expect(coverageColor(45)).toBe("#f97316");
    expect(coverageColor(0)).toBe("#ef4444");
  });
});
