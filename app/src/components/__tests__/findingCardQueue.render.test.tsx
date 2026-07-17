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
    expect(link.getAttribute("href")).toBe("/findings/f-99?from=findings_queue");
  });
});
