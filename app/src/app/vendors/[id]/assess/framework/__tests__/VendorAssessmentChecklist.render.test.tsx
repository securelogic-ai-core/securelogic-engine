/**
 * VendorAssessmentChecklist — the progress panel updates the moment an answer
 * is recorded, and rolls back when the engine rejects the save.
 *
 * Same contract as the self-assessment checklist: progress counts answers
 * (pass, partial and fail equally — O-5 ruling) and must never overstate what
 * actually persisted. A failed save that left the optimistic answer in place
 * would show a progress percentage the framework detail page could not
 * reproduce.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { FrameworkRequirements } from "@/lib/api";
import { VendorAssessmentChecklist } from "../VendorAssessmentChecklist";

function aRequirement(
  n: number,
  status: "pass" | "partial" | "fail" | null
): FrameworkRequirements["requirements"][number] {
  const id = `00000000-0000-0000-0000-00000000000${n}`;
  return {
    id,
    reference_id: `REQ-${n}`,
    title: `Requirement ${n}`,
    description: null,
    response: status
      ? {
          id: `10000000-0000-0000-0000-00000000000${n}`,
          requirement_id: id,
          assessment_type: "vendor",
          subject_id: "v-1",
          status,
          notes: null,
          evidence_url: null,
          assessed_at: "2026-07-16T00:00:00.000Z",
        }
      : null,
  };
}

function checklistData(
  requirements: FrameworkRequirements["requirements"]
): FrameworkRequirements {
  const pass = requirements.filter((r) => r.response?.status === "pass").length;
  const partial = requirements.filter((r) => r.response?.status === "partial").length;
  const fail = requirements.filter((r) => r.response?.status === "fail").length;
  const total = requirements.length;
  return {
    framework: { id: "f-1", name: "SOC 2", version: "2017 TSC" },
    requirements,
    summary: {
      total,
      pass,
      partial,
      fail,
      not_assessed: total - pass - partial - fail,
      progress_pct: total === 0 ? 0 : Math.round(((pass + partial + fail) / total) * 100),
    },
  };
}

describe("VendorAssessmentChecklist — immediate metrics + rollback on failed save", () => {
  it("advances the progress panel on the same click that records the answer", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(
      <VendorAssessmentChecklist
        vendorId="v-1"
        frameworkId="f-1"
        initialData={checklistData([aRequirement(1, "fail"), aRequirement(2, null)])}
      />
    );
    expect(screen.getByText("1 of 2 assessed · 50%")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Pass" })[1]!);

    expect(screen.getByText("2 of 2 assessed · 100%")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("rolls the count back when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    render(
      <VendorAssessmentChecklist
        vendorId="v-1"
        frameworkId="f-1"
        initialData={checklistData([aRequirement(1, "fail"), aRequirement(2, null)])}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Pass" })[1]!);
    expect(screen.getByText("2 of 2 assessed · 100%")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("1 of 2 assessed · 50%")).toBeInTheDocument()
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
