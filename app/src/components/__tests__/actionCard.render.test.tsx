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
let onUnblock: (actionId: string) => Promise<void>;

beforeEach(() => {
  onStatusChange = vi.fn(async () => {});
  onPlanChange = vi.fn(async () => {});
  onUnblock = vi.fn(async () => {});
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
    fireEvent.change(dateInputs[dateInputs.length - 1]!, { target: { value: "2027-01-15" } });

    fireEvent.click(screen.getByRole("button", { name: "Block action" }));

    expect(onPlanChange).toHaveBeenCalledWith("a-1", {
      status: "blocked",
      blocked_reason: "Vendor patch pending",
      blocked_dependency: "CR-1042",
      blocked_owner_user_id: "u-2",
      blocked_expected_unblock_date: "2027-01-15",
    });
  });

  it("rejects an expected unblock date in the past — a forecast can't be history", () => {
    render(<ActionCard action={anAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} owners={owners} />);
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.change(screen.getByPlaceholderText(/Waiting on vendor patch/i), { target: { value: "Vendor patch pending" } });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[dateInputs.length - 1]!, { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Block action" }));
    expect(screen.getByText(/Expected unblock date can't be in the past/i)).toBeInTheDocument();
    expect(onPlanChange).not.toHaveBeenCalled();
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

describe("Unblock — explicit Confirm/Cancel, not a bare status flip", () => {
  function blockedAction() {
    return anAction({
      status: "blocked",
      blocked_reason: "Awaiting vendor",
      blocked_dependency: "CR-9",
    });
  }

  it("clicking Unblock opens a confirmation instead of transitioning immediately", () => {
    render(
      <ActionCard action={blockedAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} onUnblock={onUnblock} owners={owners} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    // No transition has fired — the confirmation dialog is shown.
    expect(onUnblock).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm unblock" })).toBeInTheDocument();
    // The blocker being resolved is shown in the dialog so the confirmation is
    // not a mystery click (the "Resolving blocker:" label is dialog-only).
    expect(screen.getByText(/Resolving blocker:/)).toBeInTheDocument();
  });

  it("Cancel leaves the action Blocked and calls nothing", () => {
    render(
      <ActionCard action={blockedAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} onUnblock={onUnblock} owners={owners} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUnblock).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
    // Still Blocked — the Unblock control is back, the status pill unchanged.
    expect(screen.getByRole("button", { name: "Unblock" })).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("Confirm calls onUnblock exactly once", () => {
    render(
      <ActionCard action={blockedAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} onUnblock={onUnblock} owners={owners} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm unblock" }));
    expect(onUnblock).toHaveBeenCalledTimes(1);
    expect(onUnblock).toHaveBeenCalledWith("a-1");
    // The bare status flip must NOT have fired.
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("without the confirm capability (legacy card), Unblock stays a bare status flip", () => {
    render(<ActionCard action={blockedAction()} findingId="f-1" onStatusChange={onStatusChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    expect(onStatusChange).toHaveBeenCalledWith("a-1", "in_progress");
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

describe("R-6 — every transition control explains what it does", () => {
  it("Start/Complete/Block carry effect tooltips on an in-progress action's controls", () => {
    render(<ActionCard action={anAction()} findingId="f-1" onStatusChange={onStatusChange} onPlanChange={onPlanChange} owners={owners} />);
    // in_progress offers Complete and Block.
    expect(screen.getByRole("button", { name: "Complete" }).getAttribute("title")).toContain(
      "the finding becomes Remediation complete and moves to the governance decision",
    );
    expect(screen.getByRole("button", { name: "Block" }).getAttribute("title")).toContain(
      "stops counting as work in flight",
    );
  });

  it("Unblock and Re-open explain themselves too", () => {
    render(
      <ActionCard
        action={anAction({ status: "blocked", blocked_reason: "Vendor" })}
        findingId="f-1"
        onStatusChange={onStatusChange}
        onPlanChange={onPlanChange}
        owners={owners}
      />,
    );
    expect(screen.getByRole("button", { name: "Unblock" }).getAttribute("title")).toContain(
      "Returns this action to In Progress",
    );

    render(
      <ActionCard
        action={anAction({ id: "a-2", status: "closed" })}
        findingId="f-1"
        onStatusChange={onStatusChange}
        onPlanChange={onPlanChange}
        owners={owners}
      />,
    );
    expect(screen.getByRole("button", { name: "Re-open" }).getAttribute("title")).toContain(
      "the finding regresses from remediated",
    );
  });
});
