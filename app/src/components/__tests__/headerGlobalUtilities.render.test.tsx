/**
 * headerGlobalUtilities.render.test.tsx — Search and Ask reach the user in BOTH
 * nav models.
 *
 * WHY THIS EXISTS: production runs `risk_workspace=false` and therefore renders
 * the legacy NAV_ITEMS. A destination wired into only the workspace IA is
 * invisible to every production user while looking correct in every review that
 * happens to have the flag on — that gap has already reached production once.
 * Search and Ask now render from the header's own utility cluster, outside both
 * menus, and these tests hold that property at the component boundary rather
 * than only in the nav arrays.
 *
 * The second property under test is that the move did not DUPLICATE either
 * entry: Ask left the user menu and the mobile drawer, so exactly one /ask
 * entry point must exist in the header at any breakpoint.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Header } from "../Header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

/** An authenticated platform user — the tier both utilities have always required. */
const PLATFORM_USER = {
  isAuthenticated: true,
  isPlatformUser: true,
  userName: "Dana Ops",
  userEmail: "dana@example.com",
  userRole: "admin",
  organizationName: "Walkthrough Org",
};

const askLinks = () => screen.queryAllByRole("link", { name: "Ask SecureLogic" });
const searchLinks = () => screen.queryAllByRole("link", { name: "Search" });

describe("Header global utilities — both nav models", () => {
  it("renders Search and Ask with the LEGACY nav (risk_workspace off — the production variant)", () => {
    render(<Header {...PLATFORM_USER} />);

    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(askLinks()).toHaveLength(1);
    expect(askLinks()[0]).toHaveAttribute("href", "/ask");
  });

  it("renders them identically with the workspace nav (risk_workspace on)", () => {
    render(<Header {...PLATFORM_USER} navFlags={{ risk_workspace: true }} />);

    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(askLinks()).toHaveLength(1);
  });

  it("suppresses both for a non-platform user, exactly as the nav entries were gated", () => {
    render(<Header {...PLATFORM_USER} isPlatformUser={false} />);

    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(askLinks()).toHaveLength(0);
    expect(searchLinks()).toHaveLength(0);
  });

  it("shows neither to a signed-out visitor", () => {
    render(<Header isAuthenticated={false} isPlatformUser />);

    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(askLinks()).toHaveLength(0);
  });
});

describe("Header global utilities — the move did not leave a second copy behind", () => {
  it("does not put Ask in the mobile drawer, because the cluster is visible at that breakpoint too", () => {
    render(<Header {...PLATFORM_USER} navFlags={{ risk_workspace: true }} />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));

    // The drawer is open and carrying the account section...
    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
    // ...but Ask is still reachable exactly once, from the cluster.
    expect(askLinks()).toHaveLength(1);
  });

  it("does not list Ask in the account menu — that menu is for the account", () => {
    render(<Header {...PLATFORM_USER} navFlags={{ risk_workspace: true }} />);

    // The avatar trigger renders the initial and carries the name as its title.
    fireEvent.click(screen.getByTitle("Dana Ops"));

    // The menu opened (its account entries are present) and Ask is not among them.
    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
    expect(askLinks()).toHaveLength(1);
  });

  it("keeps Search and Ask out of the primary workspace nav itself", () => {
    render(<Header {...PLATFORM_USER} navFlags={{ risk_workspace: true }} />);

    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByRole("link", { name: "Ask SecureLogic" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Search" })).not.toBeInTheDocument();
  });
});
