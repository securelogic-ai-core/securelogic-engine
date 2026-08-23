/**
 * UseDecisionForm (T2-D2) — the write path for the formal use decision.
 *
 * The form mirrors the engine's consistency rules client-side, and these tests
 * pin that mirror to the API's actual 400 rules: rationale required on EVERY
 * decision, conditions shown+required ONLY for approved_with_conditions, expiry
 * offered ONLY for the two approving decisions. The engine stays authoritative —
 * the last test pins that a server refusal surfaces instead of vanishing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  recordUseDecision: vi.fn(),
}));

vi.mock("../[id]/governanceActions", () => actions);

import {
  UseDecisionForm,
  USE_DECISION_OPTIONS,
  assessmentOptionLabel,
  type UseDecisionAssessmentOption,
} from "../[id]/UseDecisionForm";

beforeEach(() => {
  vi.clearAllMocks();
  actions.recordUseDecision.mockResolvedValue({ ok: true });
});

function openForm() {
  render(<UseDecisionForm aiSystemId="ai-1" />);
  fireEvent.click(screen.getByRole("button", { name: "+ Record decision" }));
}

function pickDecision(value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Decision" }), {
    target: { value },
  });
}

describe("UseDecisionForm — conditional fields mirror the engine's rules", () => {
  it("offers exactly the engine's closed decision vocabulary", () => {
    openForm();
    const select = screen.getByRole("combobox", { name: "Decision" });
    const values = Array.from(select.querySelectorAll("option"))
      .map((o) => o.getAttribute("value"))
      .filter(Boolean);
    expect(values).toEqual(USE_DECISION_OPTIONS.map((o) => o.value));
    expect(values).toEqual(["approved", "approved_with_conditions", "rejected", "suspended"]);
  });

  it("conditions appear ONLY for approved_with_conditions", () => {
    openForm();
    expect(screen.queryByRole("textbox", { name: "Conditions" })).toBeNull();

    pickDecision("approved_with_conditions");
    expect(screen.getByRole("textbox", { name: "Conditions" })).toBeInTheDocument();

    pickDecision("rejected");
    expect(screen.queryByRole("textbox", { name: "Conditions" })).toBeNull();
  });

  it("the expiry date is offered ONLY for the two approving decisions — a rejection stands until superseded", () => {
    openForm();
    pickDecision("approved");
    expect(screen.getByLabelText("Expiry date")).toBeInTheDocument();

    pickDecision("approved_with_conditions");
    expect(screen.getByLabelText("Expiry date")).toBeInTheDocument();

    pickDecision("rejected");
    expect(screen.queryByLabelText("Expiry date")).toBeNull();

    pickDecision("suspended");
    expect(screen.queryByLabelText("Expiry date")).toBeNull();
  });

  it("refuses to submit without a rationale — every decision must state its grounds", async () => {
    openForm();
    pickDecision("rejected");
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Every use decision must state its grounds."
    );
    expect(actions.recordUseDecision).not.toHaveBeenCalled();
  });

  it("refuses a conditional approval without conditions", async () => {
    openForm();
    pickDecision("approved_with_conditions");
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Meets the bar with guardrails." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A conditional approval must state its conditions."
    );
    expect(actions.recordUseDecision).not.toHaveBeenCalled();
  });

  it("submits decision, rationale, conditions and expiry for a conditional approval", async () => {
    openForm();
    pickDecision("approved_with_conditions");
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Meets the bar with guardrails." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Conditions" }), {
      target: { value: "Human review of all outputs." },
    });
    fireEvent.change(screen.getByLabelText("Expiry date"), {
      target: { value: "2027-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(actions.recordUseDecision).toHaveBeenCalledTimes(1));
    const [aiSystemId, formData] = actions.recordUseDecision.mock.calls[0]!;
    expect(aiSystemId).toBe("ai-1");
    expect((formData as FormData).get("decision")).toBe("approved_with_conditions");
    expect((formData as FormData).get("rationale")).toBe("Meets the bar with guardrails.");
    expect((formData as FormData).get("conditions")).toBe("Human review of all outputs.");
    expect((formData as FormData).get("expires_at")).toBe("2027-01-01");
  });

  it("never sends conditions on a plain approval — mirroring conditions_only_on_conditional_approval", async () => {
    openForm();
    // Type conditions under the conditional decision, then flip to plain approval:
    // the stale conditions must not ride along and draw the engine's 400.
    pickDecision("approved_with_conditions");
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Clean assessment." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Conditions" }), {
      target: { value: "left over" },
    });
    pickDecision("approved");
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(actions.recordUseDecision).toHaveBeenCalledTimes(1));
    const [, formData] = actions.recordUseDecision.mock.calls[0]!;
    expect((formData as FormData).get("conditions")).toBeNull();
  });

  it("surfaces a server refusal instead of silently closing", async () => {
    actions.recordUseDecision.mockResolvedValue({
      error: "Contributors can't record use decisions.",
    });
    openForm();
    pickDecision("suspended");
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Model drift confirmed in production." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Contributors can't record use decisions."
    );
    // Still open — the customer's typed rationale is not thrown away.
    expect(screen.getByRole("textbox", { name: "Rationale" })).toHaveValue(
      "Model drift confirmed in production."
    );
  });
});

// ─── The assessment picker: what the decision was made AGAINST ───────────────

const ASSESSMENTS: UseDecisionAssessmentOption[] = [
  {
    id: "assess-1",
    status: "compliant",
    performed_at: "2026-06-01T00:00:00.000Z",
    summary: "Annual model review",
  },
  {
    id: "assess-2",
    status: "partially_compliant",
    performed_at: null,
    summary: null,
  },
];

function openFormWithAssessments() {
  render(<UseDecisionForm aiSystemId="ai-1" assessments={ASSESSMENTS} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Record decision" }));
}

describe("UseDecisionForm — the assessment picker", () => {
  it("does not render with no assessments — an empty dropdown would imply a choice that does not exist", () => {
    openForm();
    expect(screen.queryByRole("combobox", { name: "Based on assessment" })).toBeNull();
  });

  it("offers this system's assessments plus an explicit no-assessment default", () => {
    openFormWithAssessments();
    const picker = screen.getByRole("combobox", { name: "Based on assessment" });
    const labels = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual([
      "No assessment — decided without one",
      "compliant — 2026-06-01 — Annual model review",
      "partially compliant — no date",
    ]);
    // Default is the honest null, not a silently preselected assessment.
    expect((picker as HTMLSelectElement).value).toBe("");
  });

  it("submits assessment_id when an assessment is picked", async () => {
    openFormWithAssessments();
    pickDecision("approved");
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "Clean assessment; approving." },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Based on assessment" }), {
      target: { value: "assess-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(actions.recordUseDecision).toHaveBeenCalledTimes(1));
    const [, formData] = actions.recordUseDecision.mock.calls[0]!;
    expect((formData as FormData).get("assessment_id")).toBe("assess-1");
  });

  it("omits assessment_id entirely when none is picked — nullable by ruling, never an empty string", async () => {
    openFormWithAssessments();
    pickDecision("rejected");
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
      target: { value: "We looked at the proposal and said no." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(actions.recordUseDecision).toHaveBeenCalledTimes(1));
    const [, formData] = actions.recordUseDecision.mock.calls[0]!;
    expect((formData as FormData).get("assessment_id")).toBeNull();
  });

  it("a rejection may cite an assessment too — the picker is offered for every decision kind", () => {
    openFormWithAssessments();
    pickDecision("rejected");
    expect(screen.getByRole("combobox", { name: "Based on assessment" })).toBeInTheDocument();
    pickDecision("suspended");
    expect(screen.getByRole("combobox", { name: "Based on assessment" })).toBeInTheDocument();
  });
});

describe("assessmentOptionLabel", () => {
  it("truncates a long summary rather than flooding the option", () => {
    const label = assessmentOptionLabel({
      id: "x",
      status: "non_compliant",
      performed_at: "2026-05-05T10:00:00.000Z",
      summary: "A".repeat(80),
    });
    expect(label).toBe(`non compliant — 2026-05-05 — ${"A".repeat(57)}…`);
  });
});
