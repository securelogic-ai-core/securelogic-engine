/**
 * findingCardQueue.render.test.tsx — the FindingCard behaviors the scalable Risk
 * Findings queue relies on: an explicit due-status label on EVERY card (incl. the
 * no-due-date case), urgency styling, and the ?from= handoff preserved for
 * open-in-new-tab.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingCard } from "../FindingCard";
import { aFinding } from "@/test/fixtures";
import { setClientPathname, setClientSearchParams } from "@/test/harness";

vi.mock("@/app/actions/updateFindingStatus", () => ({
  updateFindingStatus: vi.fn(async () => ({ ok: true })),
}));

const iso = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

describe("queue card — explicit due-status label on every card (showDueStatus)", () => {
  it("labels a no-due-date finding 'No due date' (never blank)", () => {
    render(<FindingCard finding={aFinding({ due_date: null })} revalidateUrl="/findings" showDueStatus />);
    expect(screen.getByText("No due date")).toBeInTheDocument();
  });

  it("labels overdue / due-today / due-in-N explicitly, not as a raw date", () => {
    const { rerender } = render(
      <FindingCard finding={aFinding({ due_date: iso(-2) })} revalidateUrl="/findings" showDueStatus />,
    );
    expect(screen.getByText("Overdue by 2 days")).toBeInTheDocument();
    rerender(<FindingCard finding={aFinding({ id: "f-a", due_date: iso(0) })} revalidateUrl="/findings" showDueStatus />);
    expect(screen.getByText("Due today")).toBeInTheDocument();
    rerender(<FindingCard finding={aFinding({ id: "f-b", due_date: iso(4) })} revalidateUrl="/findings" showDueStatus />);
    expect(screen.getByText("Due in 4 days")).toBeInTheDocument();
  });

  it("legacy card (no showDueStatus, no workspace) does NOT show 'No due date'", () => {
    render(<FindingCard finding={aFinding({ due_date: null })} revalidateUrl="/findings" />);
    expect(screen.queryByText("No due date")).toBeNull();
  });
});

describe("queue card — originating-queue handoff preserved for new-tab", () => {
  it("the Open decision link carries ?from=<queueContext>", () => {
    render(
      <FindingCard
        finding={aFinding({ id: "f-99" })}
        revalidateUrl="/findings"
        workspace
        showDueStatus
        queueContext="findings_queue"
      />,
    );
    const link = screen.getByRole("link", { name: /Open .*decision/i });
    expect(link.getAttribute("href")).toContain("from=findings_queue");
  });

  it("on the findings surface, the link also carries an exact ?return= for a filtered/paginated queue", () => {
    // Simulate the browser being on the browse queue with search + sort + page.
    setClientPathname("/findings");
    setClientSearchParams("q=azure&severity=Critical&sort=due_asc&page=3");
    render(
      <FindingCard
        finding={aFinding({ id: "f-99" })}
        revalidateUrl="/findings"
        workspace
        showDueStatus
        queueContext="findings_queue"
      />,
    );
    const href = screen.getByRole("link", { name: /Open .*decision/i }).getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/findings/f-99?")).toBe(true);
    expect(params.get("from")).toBe("findings_queue");
    // Search, filters, sort, and page survive the round-trip — a new tab restores
    // the exact queue from the URL, not from history/memory.
    expect(params.get("return")).toBe("/findings?q=azure&severity=Critical&sort=due_asc&page=3");
  });

  it("an Operations Center bucket carries ?from=<bucketId> and a ?return= to that bucket", () => {
    setClientPathname("/findings");
    setClientSearchParams("bucket=needs_decision&after=2026-01-01~abc");
    render(
      <FindingCard
        finding={aFinding({ id: "f-77" })}
        revalidateUrl="/findings?bucket=needs_decision"
        workspace
        queueContext="needs_decision"
      />,
    );
    const href = screen.getByRole("link", { name: /Open .*decision/i }).getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("from")).toBe("needs_decision");
    // The return points back at the same bucket + cursor. (`~` round-trips as %7E
    // through URLSearchParams; Next decodes it on navigation — assert the parsed
    // params, not the raw encoding.)
    const ret = params.get("return")!;
    expect(ret.startsWith("/findings?")).toBe(true);
    const retParams = new URLSearchParams(ret.split("?")[1]);
    expect(retParams.get("bucket")).toBe("needs_decision");
    expect(retParams.get("after")).toBe("2026-01-01~abc");
  });
});
