/**
 * AssessmentChecklist — the progress panel is COMPLETION, never readiness
 * (O-5 ruling, 2026-07-16).
 *
 * The old panel computed `(pass + partial*0.5)/total` — a quality-weighted
 * score wearing the "Assessment Progress" label, and the same formula the
 * engine used to publish as `readiness_score`. Progress now counts answered
 * requirements only: pass, partial, and fail all advance it equally, and no
 * answer combination can make it read as an implementation verdict.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { FrameworkRequirements } from "@/lib/api";
import { AssessmentChecklist } from "../AssessmentChecklist";

vi.mock("../actions", () => ({
  createFindingsForFailures: vi.fn(),
}));

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
          assessment_type: "self",
          subject_id: "org-1",
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
    framework: { id: "f-1", name: "O-5 Framework", version: "1.0" },
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

describe("AssessmentChecklist progress panel — completion, not readiness", () => {
  it("counts answered requirements: 1 pass + 1 partial + 1 fail of 4 → 75%, never the blended 37.5%", () => {
    render(
      <AssessmentChecklist
        frameworkId="f-1"
        subjectId="org-1"
        initialData={checklistData([
          aRequirement(1, "pass"),
          aRequirement(2, "partial"),
          aRequirement(3, "fail"),
          aRequirement(4, null),
        ])}
      />
    );

    expect(screen.getByText("Assessment Progress")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 assessed · 75%")).toBeInTheDocument();
    // The old blended formula would print 37.5% here.
    expect(screen.queryByText(/37\.5/)).not.toBeInTheDocument();
  });

  it("all-fail answers still show full progress — answering honestly is progress, not readiness", () => {
    render(
      <AssessmentChecklist
        frameworkId="f-1"
        subjectId="org-1"
        initialData={checklistData([
          aRequirement(1, "fail"),
          aRequirement(2, "fail"),
        ])}
      />
    );
    expect(screen.getByText("2 of 2 assessed · 100%")).toBeInTheDocument();
  });

  it("renders an honest empty state at zero requirements", () => {
    render(
      <AssessmentChecklist frameworkId="f-1" subjectId="org-1" initialData={checklistData([])} />
    );
    expect(screen.getByText("0 of 0 assessed · 0%")).toBeInTheDocument();
  });
});

describe("AssessmentChecklist — metrics update on save, and roll back when the save fails", () => {
  it("advances the progress panel the moment a status is recorded — no refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    );
    render(
      <AssessmentChecklist
        frameworkId="f-1"
        subjectId="org-1"
        initialData={checklistData([aRequirement(1, "pass"), aRequirement(2, null)])}
      />
    );
    expect(screen.getByText("1 of 2 assessed · 50%")).toBeInTheDocument();

    // REQ-2 is unanswered; its "Pass" button is the second one on the page.
    fireEvent.click(screen.getAllByRole("button", { name: "Pass" })[1]!);

    // Synchronous optimistic update: the panel recomputes on the same click.
    expect(screen.getByText("2 of 2 assessed · 100%")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("rolls the count back when the engine rejects the save — progress never overstates what persisted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    render(
      <AssessmentChecklist
        frameworkId="f-1"
        subjectId="org-1"
        initialData={checklistData([aRequirement(1, "pass"), aRequirement(2, null)])}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Pass" })[1]!);
    expect(screen.getByText("2 of 2 assessed · 100%")).toBeInTheDocument();

    // The failed save reverts the optimistic answer and surfaces the error.
    await waitFor(() =>
      expect(screen.getByText("1 of 2 assessed · 50%")).toBeInTheDocument()
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
