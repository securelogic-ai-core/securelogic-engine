/**
 * RecordRetestControl — the retest form's contract (T2-I).
 *
 * What these tests pin: notes are REQUIRED exactly when the result leaves the
 * exposure open (not_remediated / partially_remediated) — mirroring the
 * engine's named 400 and the DB CHECK behind it — and optional for a
 * remediated result; the server action's error renders as a sentence; and the
 * success state says out loud that a retest NEVER closes the finding, so
 * nobody waits for a status flip that will not come.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { hrefOf } from "@/test/harness";

const actions = vi.hoisted(() => ({
  recordRetest: vi.fn(),
}));

vi.mock("../[id]/actions", () => actions);

import { RecordRetestControl } from "../[id]/RecordRetestControl";

const ENGAGEMENT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const FINDING_ID = "f-1";

function openForm() {
  const rendered = render(
    <RecordRetestControl engagementId={ENGAGEMENT_ID} findingId={FINDING_ID} />
  );
  fireEvent.click(screen.getByRole("button", { name: "Record retest" }));
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.recordRetest.mockResolvedValue({});
});

describe("RecordRetestControl — the conditional notes requirement", () => {
  it("notes are optional for a remediated result", () => {
    openForm();

    const notes = screen.getByLabelText(/Notes/) as HTMLTextAreaElement;
    expect(notes.required).toBe(false);
    expect(
      screen.queryByText(/must say what the tester found/)
    ).not.toBeInTheDocument();
  });

  it("notes become required the moment the result leaves the exposure open", () => {
    openForm();

    fireEvent.change(screen.getByLabelText("Result"), {
      target: { value: "not_remediated" },
    });

    const notes = screen.getByLabelText(/Notes/) as HTMLTextAreaElement;
    expect(notes.required).toBe(true);
    expect(
      screen.getByText(/A retest that leaves the exposure open must say what the tester found/)
    ).toBeInTheDocument();
  });

  it("partially_remediated requires notes too — partial is still open", () => {
    openForm();

    fireEvent.change(screen.getByLabelText("Result"), {
      target: { value: "partially_remediated" },
    });

    expect((screen.getByLabelText(/Notes/) as HTMLTextAreaElement).required).toBe(true);
  });
});

describe("RecordRetestControl — submission", () => {
  it("posts result, notes, and performed_on through the server action", async () => {
    openForm();

    fireEvent.change(screen.getByLabelText("Result"), {
      target: { value: "not_remediated" },
    });
    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: "Host still reachable on the vulnerable port." },
    });
    fireEvent.change(screen.getByLabelText("Performed On"), {
      target: { value: "2026-08-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record Retest" }));

    await waitFor(() => expect(actions.recordRetest).toHaveBeenCalledTimes(1));
    const [engagementId, findingId, formData] = actions.recordRetest.mock.calls[0] as [
      string,
      string,
      FormData,
    ];
    expect(engagementId).toBe(ENGAGEMENT_ID);
    expect(findingId).toBe(FINDING_ID);
    expect(formData.get("result")).toBe("not_remediated");
    expect(formData.get("notes")).toBe("Host still reachable on the vulnerable port.");
    expect(formData.get("performed_on")).toBe("2026-08-15");
  });

  it("renders the server action's error as a sentence — the engine's notes_required 400 included", async () => {
    actions.recordRetest.mockResolvedValue({
      error: "A retest that leaves the exposure open must say what the tester found",
    });
    openForm();

    fireEvent.click(screen.getByRole("button", { name: "Record Retest" }));

    expect(
      await screen.findByText(
        "A retest that leaves the exposure open must say what the tester found"
      )
    ).toBeInTheDocument();
    // The form stays open so the notes can be supplied.
    expect(screen.getByLabelText(/Notes/)).toBeInTheDocument();
  });

  it("success says the history lives on the finding — and that a retest never closes it", async () => {
    const { container } = openForm();

    fireEvent.click(screen.getByRole("button", { name: "Record Retest" }));

    expect(await screen.findByText(/Retest recorded/)).toBeInTheDocument();
    expect(
      screen.getByText(/A retest never closes the finding/)
    ).toBeInTheDocument();
    expect(hrefOf(container, "history is on the finding")).toBe(`/findings/${FINDING_ID}`);
  });
});
