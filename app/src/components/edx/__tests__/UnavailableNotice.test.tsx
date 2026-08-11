/**
 * UnavailableNotice — the contract a future rewrite must not quietly drop.
 *
 * The headline is the easy part. What these tests defend is everything that
 * distinguished the good outage states from the bare ones: the denial sentence,
 * the refusal to attribute a cause, the assertive announcement, and a retry
 * that is a real control rather than prose.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnavailableNotice } from "../UnavailableNotice";

describe("UnavailableNotice", () => {
  it("names the subject that failed — never a bare 'something went wrong'", () => {
    render(<UnavailableNotice subject="Vendors" denial="not an empty register" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Vendors couldn’t be loaded right now\./);
  });

  it("states the denial — the false reading the customer would otherwise reach", () => {
    render(
      <UnavailableNotice
        subject="Vendors"
        denial="not a limit of your plan, and not an empty register"
        reassurance="Your vendors are unchanged."
      />,
    );
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toMatch(/This is a loading problem/);
    expect(text).toMatch(/not a limit of your plan/);
    expect(text).toMatch(/not an empty register/);
    expect(text).toMatch(/Your vendors are unchanged\./);
  });

  it("announces assertively — an outage must reach assistive tech, not just sighted readers", () => {
    render(<UnavailableNotice subject="Policies" denial="not an empty library" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders the retry as a real focusable control pointing at the given href", () => {
    render(
      <UnavailableNotice subject="Controls" denial="not an empty library" retryHref="/controls?filter=overdue" />,
    );
    const link = screen.getByRole("link", { name: /try again/i });
    expect(link.getAttribute("href")).toBe("/controls?filter=overdue");
  });

  it("renders NO retry affordance when there is no href — prose is not a recovery path", () => {
    render(<UnavailableNotice subject="Controls" denial="not an empty library" />);
    expect(screen.queryByRole("link", { name: /try again/i })).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toMatch(/refresh/i);
  });

  it("never attributes a cause the app layer cannot see", () => {
    render(
      <UnavailableNotice
        subject="Obligations"
        denial="not a limit of your plan, and not an empty register"
        reassurance="Your obligations are unchanged."
        retryHref="/obligations"
      />,
    );
    const text = screen.getByRole("alert").textContent ?? "";
    // The component may DENY a plan limit; it may never ASSERT one.
    expect(text).not.toMatch(/is not available for your current plan/i);
    expect(text).not.toMatch(/upgrade/i);
    expect(text).not.toMatch(/permission/i);
  });
});
