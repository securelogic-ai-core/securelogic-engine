/**
 * headerTwoRow.render.test.tsx — the authenticated header is a REAL two-row
 * structure.
 *
 * WHY THIS EXISTS: the approved authenticated header is
 *
 *   ROW 1  logo …………………………………… Search | Ask SecureLogic | Avatar
 *   ROW 2  Briefing | Posture | Intelligence | Risk Operations | Assets |
 *          Vendor Assurance | Compliance | Context
 *
 * and it shipped as a SINGLE h-14 flex row with the workspace nav wedged
 * between the wordmark and the utility cluster. The failure mode this guards
 * against is the cheap fix: pushing the nav down with a margin, a padding
 * offset or an absolute position on the header, which LOOKS like two rows at
 * one viewport and collapses at every other. The structural property — the nav
 * band is a SIBLING of the row-1 container, not a descendant of it — is what
 * makes the layout real, and it cannot be asserted from a screenshot.
 *
 * It also pins the two things a well-meaning refactor breaks next: that nothing
 * from row 1 falls into row 2, and that the mobile drawer stays the sole nav
 * path below the `md` breakpoint.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Header } from "../Header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

/** Authenticated platform user on the workspace IA — the staging/target variant. */
const WORKSPACE_USER = {
  isAuthenticated: true,
  isPlatformUser: true,
  userName: "Dana Ops",
  userEmail: "dana@example.com",
  userRole: "admin",
  organizationName: "Walkthrough Org",
  // The staging/target flag set. `briefing` is what relabels the /dashboard
  // entry to "Briefing"; `enterprise_context` is what admits "Context". Both
  // are on in staging, which is why the approved list names those two labels.
  navFlags: {
    risk_workspace: true,
    briefing: true,
    enterprise_context: true,
  } as Record<string, boolean>,
};

const headerEl = () => document.querySelector("header") as HTMLElement;
/** ROW 1 is the first element child of <header>. */
const rowOne = () => headerEl().children[0] as HTMLElement;

describe("authenticated header — real two-row structure", () => {
  it("renders the workspace nav as a SIBLING of row 1, not inside it", () => {
    render(<Header {...WORKSPACE_USER} />);

    const nav = screen.getByRole("navigation");

    // The structural claim. If someone re-nests the nav into the row-1 flex
    // container and fakes the second row with a margin, this fails.
    expect(rowOne().contains(nav)).toBe(false);
    expect(headerEl().contains(nav)).toBe(true);
    expect(headerEl().children.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the wordmark, Search, Ask and the avatar in row 1", () => {
    render(<Header {...WORKSPACE_USER} />);

    const row1 = rowOne();
    expect(within(row1).getByRole("search")).toBeInTheDocument();
    expect(within(row1).getByRole("link", { name: "Ask SecureLogic" })).toBeInTheDocument();
    expect(within(row1).getByRole("link", { name: /SecureLogic AI/ })).toBeInTheDocument();
    // The avatar control (UserMenu) is keyed by its title, as in the sibling suite.
    expect(within(row1).getByTitle("Dana Ops")).toBeInTheDocument();

    // …and none of them leaked into the nav band.
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByRole("search")).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Ask SecureLogic" })).not.toBeInTheDocument();
    expect(within(nav).queryByTitle("Dana Ops")).not.toBeInTheDocument();
  });

  it("puts the approved workspace entries in row 2, in order", () => {
    render(<Header {...WORKSPACE_USER} />);

    const nav = screen.getByRole("navigation");
    const labels = [...nav.children].map(c => (c.textContent ?? "").trim());

    // Audit Log is admin-gated and legitimately present for this admin user;
    // the approved list describes a non-admin. Assert the approved sequence is
    // a prefix, which holds for both.
    expect(labels.slice(0, 8)).toEqual([
      "Briefing",
      "Posture",
      "Intelligence",
      "Risk Operations",
      "Assets",
      "Vendor Assurance",
      "Compliance",
      "Context",
    ]);
  });

  it("gives a signed-out visitor no nav band at all", () => {
    render(<Header isAuthenticated={false} />);

    // The marketing links stay in row 1; there is no second row to render.
    const nav = screen.getByRole("navigation");
    expect(rowOne().contains(nav)).toBe(true);
    expect(screen.getByRole("link", { name: "Sign In" })).toBeInTheDocument();
  });

  it("still collapses to the drawer below `md`, which remains the only nav path there", () => {
    render(<Header {...WORKSPACE_USER} />);

    // The band is hidden below md; the hamburger takes over at the same
    // breakpoint. Class assertions are the only way to pin a Tailwind
    // breakpoint in jsdom, which has no layout engine.
    const band = screen.getByRole("navigation").closest("div[class*='md:block']");
    expect(band).not.toBeNull();
    expect(band!.className).toContain("hidden");

    const toggle = screen.getByRole("button", { name: "Toggle menu" });
    expect(toggle.className).toContain("md:hidden");
  });
});
