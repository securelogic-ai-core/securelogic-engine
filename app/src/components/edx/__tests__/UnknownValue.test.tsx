/**
 * UnknownValue — the contract that stops a missing count becoming a zero.
 *
 * The dash is the cheap part. What these tests defend is that it is NAMED (so
 * assistive technology and a hover both get more than a punctuation mark), that
 * it refuses the specific wrong reading, and that it attributes no cause — the
 * app layer cannot tell a 500 from a 403 and must claim neither.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnknownValue, UnknownValueNote } from "../UnknownValue";

describe("UnknownValue", () => {
  it("renders a dash, never a digit", () => {
    const { container } = render(<UnknownValue label="Overdue" />);

    expect(container.textContent?.trim()).toBe("—");
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("names the count it stands in for, and denies that it is a zero", () => {
    render(<UnknownValue label="Overdue" />);

    const el = screen.getByTitle(/Overdue is unavailable/);
    expect(el).toHaveAttribute("aria-label", expect.stringContaining("not a zero"));
  });

  it("attributes no cause — no plan, no permission, no blame", () => {
    render(<UnknownValue label="Open" />);

    const described = screen.getByTitle(/Open is unavailable/).getAttribute("title") ?? "";
    expect(described).not.toMatch(/plan|permission|subscription|upgrade|denied/i);
  });

  it("keeps the caller's type scale — the tile decides its own size", () => {
    const { container } = render(
      <UnknownValue label="Open" style={{ color: "#ffffff" }} />
    );

    // Merged OVER the default muted colour, not ignored.
    expect(container.querySelector("span")).toHaveStyle({ color: "#ffffff" });
  });
});

describe("UnknownValueNote", () => {
  it("says the dash is a loading problem and not a zero", () => {
    render(<UnknownValueNote />);

    const text = screen.getByText(/shown as/).textContent ?? "";
    expect(text).toMatch(/loading problem/);
    expect(text).toMatch(/not a zero/);
  });

  it("names the subject when the surface gives it one", () => {
    render(<UnknownValueNote subject="Two action counts" />);

    expect(screen.getByText(/Two action counts/)).toBeInTheDocument();
  });

  it("attributes no cause", () => {
    render(<UnknownValueNote />);

    const text = screen.getByText(/shown as/).textContent ?? "";
    expect(text).not.toMatch(/plan|permission|subscription|upgrade|denied/i);
  });
});
