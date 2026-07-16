/**
 * /posture — render contract.
 *
 * THE DEFECT THIS FILE EXISTS FOR: the posture tiles printed `findings.open`, which is
 * the engine's ACTIVE count (dashboard.ts aliases `open` to the active total), but every
 * link on the page pointed at `/findings?status=open` — the STRICTLY-OPEN list. A tile
 * reading 9 landed on a list of 6, and the customer had no way to tell which number was
 * a lie. The tile was right; the destination was wrong.
 *
 * These tests assert the number and its destination agree. They fail against the old page.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, signedOut, sp } from "@/test/harness";
import { aDashboardSummary, aMe } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getDashboardSummary: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import PosturePage from "../page";

/** Every anchor href on the page. */
function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

/** The anchor whose href is exactly `href`. */
function linkTo(container: HTMLElement, href: string): HTMLAnchorElement | undefined {
  return Array.from(container.querySelectorAll("a")).find((a) => a.getAttribute("href") === href);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.getDashboardSummary.mockResolvedValue(aDashboardSummary());
});

describe("/posture — every findings number reconciles with the list it links to", () => {
  it("no findings link points at the strictly-open list", async () => {
    const { container } = await renderPage(PosturePage, { searchParams: sp({}) });

    const findingLinks = hrefs(container).filter((h) => h.startsWith("/findings"));
    expect(findingLinks.length).toBeGreaterThan(0);

    for (const href of findingLinks) {
      // The tiles count ACTIVE. A `status=open` destination serves a strictly SMALLER
      // population, so the number on the tile cannot be reproduced by the page it opens.
      expect(href).not.toContain("status=open");
    }

    // Every link that CARRIES A NUMBER must land on the population it counted. The one
    // exception is the bare "/findings" browse-all link on the Domains tile — it makes no
    // numeric claim, so it is free to show the unfiltered list.
    for (const href of findingLinks.filter((h) => h !== "/findings")) {
      expect(href).toContain("active=true");
    }
  });

  it("the total tile prints the ACTIVE count and links to the ACTIVE list", async () => {
    const { container } = await renderPage(PosturePage, { searchParams: sp({}) });

    // aDashboardSummary: findings.open = 8, the engine's active total.
    const tile = screen.getByText("Total Active Findings").parentElement as HTMLElement;
    expect(tile.textContent).toContain("8");

    const viewAll = Array.from(container.querySelectorAll("a")).find((a) =>
      /View all active findings/.test(a.textContent ?? "")
    );
    expect(viewAll?.getAttribute("href")).toBe("/findings?active=true");
    expect(hrefs(container)).toContain("/findings?active=true");
  });

  it("each severity tile links to the ACTIVE list for that severity", async () => {
    const { container } = await renderPage(PosturePage, { searchParams: sp({}) });

    // by_severity: Critical 2, High 3, Moderate 2, Low 1 — and each must be reachable
    // as the SAME population it counts.
    for (const [sev, count] of [
      ["Critical", "2"],
      ["High", "3"],
      ["Moderate", "2"],
      ["Low", "1"],
    ] as const) {
      const link = linkTo(container, `/findings?severity=${sev}&active=true`);
      expect(link, `no active link for ${sev}`).toBeDefined();
      expect(link!.textContent).toContain(count);
    }
  });

  it("the severity tiles SUM to the total tile — one population, counted once", async () => {
    const { container } = await renderPage(PosturePage, { searchParams: sp({}) });

    // Read the rendered numbers back out and add them up: 2 + 3 + 2 + 1 = 8. If any tile
    // ever reads a different population than the total, the sum stops matching — which is
    // precisely how the strictly-open/active split stayed invisible for so long. Both
    // halves must be derived from the DOM, or this proves nothing.
    const severitySum = (["Critical", "High", "Moderate", "Low"] as const)
      .map((sev) => linkTo(container, `/findings?severity=${sev}&active=true`))
      .map((link) => Number(link!.textContent!.match(/\d+/)![0]))
      .reduce((a, b) => a + b, 0);

    const total = screen.getByText("Total Active Findings").parentElement as HTMLElement;
    const totalValue = Number(total.textContent!.match(/\d+/)![0]);

    expect(severitySum).toBe(totalValue);
    expect(totalValue).toBe(8);
  });

  it("the old 'Open Findings' framing is gone from the page", async () => {
    const { container } = await renderPage(PosturePage, { searchParams: sp({}) });
    expect(container.textContent).not.toContain("Total Open Findings");
    expect(container.textContent).not.toContain("Open Findings by Severity");
  });
});

describe("/posture — health-style display (posture display ruling 2026-07-15)", () => {
  it("frames posture as HEALTH (higher = better) and never as risk-style", async () => {
    const { container } = await renderPage(PosturePage, { searchParams: sp({}) });
    // The header and the domain table both carry the health caption.
    expect(screen.getAllByText(/higher = better/i).length).toBeGreaterThanOrEqual(2);
    // The app regression the ruling demands: no surface renders raw risk framing.
    expect(container.textContent).not.toContain("risk position");
    expect(container.textContent).not.toMatch(/higher = more risk/i);
  });

  it("formats the snapshot date in UTC (item 2b — no off-by-one-day split)", async () => {
    // Fixture snapshot_date is 2026-06-01T00:00:00.000Z; a non-UTC format renders
    // "May 31" in any negative-UTC zone. The shared helper pins UTC.
    const { container } = await renderPage(PosturePage, { searchParams: sp({}) });
    expect(container.textContent).toContain("as of Jun 1, 2026");
    expect(container.textContent).not.toContain("May 31");
  });
});

describe("/posture — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(PosturePage, { searchParams: sp({}) })).toBe("/login");
  });

  it("sends a non-platform (unentitled) user to /dashboard", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));
    expect(await expectRedirect(PosturePage, { searchParams: sp({}) })).toBe("/dashboard");
  });
});
