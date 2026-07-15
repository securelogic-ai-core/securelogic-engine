/**
 * ActionCard — remediation action controls. The walkthrough found: Block was a
 * bare status flip with nowhere to say why; Reassign auto-committed on every
 * keystroke with an ambiguous "Done"; due dates were unvalidated. These tests pin
 * the fixes (R-10, R-11, R-13, R-14) and that a blocked action shows its blocker.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ActionCard, type ActionPatch } from "../ActionCard";
import type { Action } from "@/lib/api";

function anAction(overrides: Partial<Action> = {}): Action {
  return {
    id: "a-1",
    organization_id: "org-1",
    title: "Enable SSE-KMS",
    description: null,
    action_type: null,
    source_type: "finding",
    source_id: "f-1",
    priority: "planned",
    due_date: null,
    owner_user_id: null,
    status: "in_progress",
    completed_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    is_overdue: false,
    ...overrides,
  };
}

const owners = [
  { id: "u-1", label: "Ana Ops" },
  { id: "u-2", label: "Ben Sec" },
];

let onStatusChange: (actionId: string, newStatus: Action["status"]) => Promise<void>;
let onPlanChange: (actionId: string, patch: ActionPatch) => Promise<void>;

beforeEach(() => {
  onStatusChange = vi.fn(async () => {});
  onPlanChange = vi.fn(async () => {});
});

describe("R-10 — Block captures structured metadata", () => {
  it("opens a dialog and sends reason/dependency/owner/date, not a bare status flip", async () => {
    render(<ActionCard action={anAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} owners={owners} />);

    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    // A bare status flip must NOT have fired — the dialog opens instead.
    expect(onStatusChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/Waiting on vendor patch/i), { target: { value: "Vendor patch pending" } });
    fireEvent.change(screen.getByPlaceholderText(/upstream ticket/i), { target: { value: "CR-1042" } });
    // blocker owner + expected unblock date
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "u-2" } });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[dateInputs.length - 1]!, { target: { value: "2026-07-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Block action" }));

    expect(onPlanChange).toHaveBeenCalledWith("a-1", {
      status: "blocked",
      blocked_reason: "Vendor patch pending",
      blocked_dependency: "CR-1042",
      blocked_owner_user_id: "u-2",
      blocked_expected_unblock_date: "2026-07-01",
    });
  });

  it("requires a blocker reason", () => {
    render(<ActionCard action={anAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} owners={owners} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Block action" }));
    expect(screen.getByText(/A blocker reason is required/i)).toBeInTheDocument();
    expect(onPlanChange).not.toHaveBeenCalled();
  });

  it("shows the blocker details on a blocked action", () => {
    render(
      <ActionCard
        action={anAction({ status: "blocked", blocked_reason: "Awaiting vendor", blocked_dependency: "CR-9", blocked_expected_unblock_date: "2026-07-15" })}
        findingId="f-1"
        onStatusChange={onStatusChange}
        onPlanChange={onPlanChange}
        owners={owners}
      />,
    );
    expect(screen.getByText(/Awaiting vendor/)).toBeInTheDocument();
    expect(screen.getByText(/Depends on: CR-9/)).toBeInTheDocument();
    expect(screen.getByText(/Expected unblock/)).toBeInTheDocument();
  });

  it("without the planning capability (legacy card), Block stays a simple status flip", () => {
    render(<ActionCard action={anAction()} findingId="f-1" onStatusChange={onStatusChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(onStatusChange).toHaveBeenCalledWith("a-1", "blocked");
  });
});

describe("R-11 / R-14 — reassign is a Save/Cancel dialog, no ambiguous Done", () => {
  it("Cancel discards without committing", () => {
    render(<ActionCard action={anAction({ owner_user_id: "u-1" })} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} owners={owners} />);
    fireEvent.click(screen.getByRole("button", { name: "Reassign / reschedule" }));
    // There is NO ambiguous "Done" control (R-14).
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onPlanChange).not.toHaveBeenCalled();
  });

  it("changing owner does NOT auto-commit; only Save does (R-11)", () => {
    render(<ActionCard action={anAction({ owner_user_id: "u-1" })} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} owners={owners} />);
    fireEvent.click(screen.getByRole("button", { name: "Reassign / reschedule" }));
    const select = screen.getAllByRole("combobox")[0]!;
    fireEvent.change(select, { target: { value: "u-2" } });
    // The old card committed on this change; the dialog must not.
    expect(onPlanChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onPlanChange).toHaveBeenCalledWith("a-1", expect.objectContaining({ owner_user_id: "u-2" }));
  });
});

describe("R-13 — due-date validation", () => {
  it("rejects a due date before the action was created", () => {
    render(<ActionCard action={anAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} owners={owners} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-05-01" } }); // before created 2026-06-01
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Due date can't be before/i)).toBeInTheDocument();
    expect(onPlanChange).not.toHaveBeenCalled();
  });
});
