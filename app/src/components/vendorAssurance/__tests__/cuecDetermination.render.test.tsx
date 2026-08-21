/**
 * cuecDetermination.render.test.tsx — the step that turns a vendor's report into
 * work, and the guardrails on it.
 *
 * The tests that matter here are the refusals. Recording a gap asserts that this
 * organisation fails a control obligation: it carries the reviewer's name, it
 * creates remediation work, and it may be read by an auditor. The UI has to make
 * that deliberate, not easy.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const determineCuec = vi.fn(async () => ({ ok: true as const }));
const promoteCuecGapToFinding = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/app/actions/vendorAssurance", () => ({
  determineCuec: (...a: unknown[]) => determineCuec(...(a as [])),
  promoteCuecGapToFinding: (...a: unknown[]) => promoteCuecGapToFinding(...(a as [])),
}));

import CuecDeterminationPanel from "../CuecDeterminationPanel";
import type { VendorAssuranceCuec } from "@/lib/api";

const cuec = (over: Partial<VendorAssuranceCuec> = {}): VendorAssuranceCuec => ({
  id: "cuec-1",
  ordinal: 0,
  cuec_text: "Customer is responsible for rotating encryption keys annually.",
  review_status: "pending",
  review_status_reason: null,
  review_status_updated_by_user_id: null,
  review_status_updated_at: null,
  gap_basis: null,
  promoted_finding_id: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  mappings: [],
  ...over,
});

const panel = (c: VendorAssuranceCuec, canDecide = true) =>
  render(<CuecDeterminationPanel documentId="doc-1" cuec={c} canDecide={canDecide} />);

describe("recording a determination", () => {
  it("offers the three outcomes in the customer's words, not the schema's", () => {
    panel(cuec());
    expect(screen.getByText("Doesn't apply to us")).toBeTruthy();
    expect(screen.getByText("We meet this")).toBeTruthy();
    expect(screen.getByText("We don't meet this")).toBeTruthy();
    // The enum values are an implementation detail and must not leak.
    expect(screen.queryByText("not_applicable")).toBeNull();
    expect(screen.queryByText("gap")).toBeNull();
  });

  it("REFUSES a gap with no reason", () => {
    panel(cuec());
    fireEvent.click(screen.getByText("We don't meet this"));
    fireEvent.click(screen.getByText("Record"));
    expect(determineCuec).not.toHaveBeenCalled();
    expect(screen.getByText(/say why this isn't met/i)).toBeTruthy();
  });

  it("submits a gap once a reason is given", () => {
    panel(cuec());
    fireEvent.click(screen.getByText("We don't meet this"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Key rotation is not implemented." } });
    fireEvent.click(screen.getByText("Record"));
    expect(determineCuec).toHaveBeenCalledWith(
      "cuec-1", "doc-1", "gap", "Key rotation is not implemented.");
  });

  it("allows a satisfied determination WITHOUT a reason", () => {
    // Only a gap is consequential enough to demand prose; requiring it
    // everywhere would just produce "n/a".
    panel(cuec());
    fireEvent.click(screen.getByText("We meet this"));
    fireEvent.click(screen.getByText("Record"));
    expect(determineCuec).toHaveBeenCalledWith("cuec-1", "doc-1", "satisfied", undefined);
  });
});

describe("promotion is a second, separate act", () => {
  it("a determined gap is NOT automatically tracked", () => {
    panel(cuec({ review_status: "gap", review_status_reason: "not implemented",
                 review_status_updated_at: "2026-08-20T00:00:00Z" }));
    // The whole point: recording a gap does not create the work.
    expect(screen.getByText(/isn't being tracked yet/i)).toBeTruthy();
    expect(promoteCuecGapToFinding).not.toHaveBeenCalled();
  });

  it("SEVERITY HAS NO DEFAULT — the button stays disabled until one is chosen", () => {
    // Severity sets the remediation deadline through the org's SLA policy. A
    // deadline nobody chose is a deadline nobody owns.
    panel(cuec({ review_status: "gap", review_status_reason: "x",
                 review_status_updated_at: "2026-08-20T00:00:00Z" }));
    const btn = screen.getByText("Create finding") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("promotes with the chosen severity", () => {
    panel(cuec({ review_status: "gap", review_status_reason: "x",
                 review_status_updated_at: "2026-08-20T00:00:00Z" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "High" } });
    fireEvent.click(screen.getByText("Create finding"));
    expect(promoteCuecGapToFinding).toHaveBeenCalledWith("cuec-1", "doc-1", "High");
  });

  it("shows the finding instead of the promote form once promoted", () => {
    panel(cuec({ review_status: "gap", review_status_reason: "x",
                 review_status_updated_at: "2026-08-20T00:00:00Z",
                 promoted_finding_id: "finding-9" }));
    expect(screen.getByText("Tracked as a finding")).toBeTruthy();
    expect(screen.queryByText("Create finding")).toBeNull();
  });
});

describe("explainability", () => {
  it("shows the control evidence behind the determination", () => {
    panel(cuec({
      review_status: "gap", review_status_reason: "not implemented",
      review_status_updated_at: "2026-08-20T00:00:00Z",
      gap_basis: {
        determined_status: "gap",
        mapped_controls: [{ control_id: "c1", control_name: "Encryption key rotation",
                            implementation_status: "not_started", maturity_level: null,
                            last_tested_at: null }],
      },
    }));
    fireEvent.click(screen.getByText(/Evidence at the time of this decision/i));
    expect(screen.getByText(/Encryption key rotation/)).toBeTruthy();
    // "Why is this a gap?" is answerable without leaving the page.
    expect(screen.getByText(/not_started/)).toBeTruthy();
  });

  it("shows the reviewer's own words back", () => {
    panel(cuec({ review_status: "gap", review_status_reason: "We have no rotation process.",
                 review_status_updated_at: "2026-08-20T00:00:00Z" }));
    expect(screen.getByText(/We have no rotation process\./)).toBeTruthy();
  });
});

describe("permissions", () => {
  it("a viewer sees the state but is offered no determination", () => {
    panel(cuec(), false);
    expect(screen.getByText(/don't have permission/i)).toBeTruthy();
    expect(screen.queryByText("We don't meet this")).toBeNull();
  });
});
