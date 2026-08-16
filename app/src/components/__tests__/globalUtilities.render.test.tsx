/**
 * globalUtilities.render.test.tsx — the header's upper-right utility cluster.
 *
 * What must hold:
 *   1. Both utilities render their real destinations: Search is a GET form that
 *      submits `q` to the canonical /search page (so it works with no client
 *      JS, exactly like the form on /search itself), and Ask links to /ask.
 *   2. Each is independently suppressible, and the cluster disappears entirely
 *      rather than rendering an empty container when neither is shown.
 *   3. Search stays reachable below the `xl` breakpoint, where the field
 *      collapses to an icon link rather than being dropped — the collapse is
 *      what makes "available from every workspace" true on tablet too.
 *   4. Active state follows the route, including Ask's sub-routes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalUtilities } from "../GlobalUtilities";

const mockPathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

const ACTIVE = "rgb(0, 196, 180)";

describe("GlobalUtilities", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/dashboard");
  });

  it("submits search as a plain GET to the canonical /search page", () => {
    render(<GlobalUtilities showSearch showAsk />);

    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/search");
    expect(form).toHaveAttribute("method", "get");

    // The parameter name is the contract with the /search page — a rename here
    // silently produces a search box that searches for nothing.
    const input = screen.getByLabelText("Search your organization");
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("type", "search");
  });

  it("links Ask to /ask", () => {
    render(<GlobalUtilities showSearch showAsk />);
    expect(screen.getByRole("link", { name: "Ask SecureLogic" })).toHaveAttribute("href", "/ask");
  });

  it("keeps search reachable below xl as an icon link to the same destination", () => {
    render(<GlobalUtilities showSearch showAsk />);
    // Present in the DOM at every breakpoint; CSS decides which of the two
    // shows. What matters is that the small-screen path is a real link to
    // /search and not a dropped feature.
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  });

  it("renders each utility independently", () => {
    const { unmount } = render(<GlobalUtilities showSearch showAsk={false} />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ask SecureLogic" })).not.toBeInTheDocument();
    unmount();

    render(<GlobalUtilities showSearch={false} showAsk />);
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask SecureLogic" })).toBeInTheDocument();
  });

  it("renders nothing at all when neither utility is available", () => {
    const { container } = render(<GlobalUtilities showSearch={false} showAsk={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks Ask active on /ask and on its sub-routes", () => {
    mockPathname.mockReturnValue("/ask");
    const { unmount } = render(<GlobalUtilities showSearch showAsk />);
    expect(screen.getByRole("link", { name: "Ask SecureLogic" })).toHaveStyle({ color: ACTIVE });
    unmount();

    // A thread URL is still Ask — losing the highlight there would tell the
    // user they had navigated away from the surface they are looking at.
    mockPathname.mockReturnValue("/ask/11111111-1111-4111-8111-111111111111");
    render(<GlobalUtilities showSearch showAsk />);
    expect(screen.getByRole("link", { name: "Ask SecureLogic" })).toHaveStyle({ color: ACTIVE });
  });

  it("does not mark Ask active on an unrelated route that merely starts with the same letters", () => {
    mockPathname.mockReturnValue("/assets");
    render(<GlobalUtilities showSearch showAsk />);
    expect(screen.getByRole("link", { name: "Ask SecureLogic" })).not.toHaveStyle({ color: ACTIVE });
  });
});
