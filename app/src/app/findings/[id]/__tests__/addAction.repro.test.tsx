import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
import { aFinding, anAction, anActionsResponse, aFindingContext, aRiskAcceptance } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getFinding: vi.fn(),
  getActionsForFinding: vi.fn(),
  getFindingContext: vi.fn(),
  getTeamMembers: vi.fn(),
  getFindingEvidence: vi.fn(),
  getRiskAcceptancesForFinding: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import FindingDetailPage from "../page";

const props = (id = "f-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

// Seed evidence shape for F1 (scripts/validation/seed-walkthrough-org.ts step 17).
const seedEvidence = {
  id: "ev-1",
  organization_id: "org-1",
  source_id: "f-1",
  source_type: "finding",
  title: "[SEED] Patch deployment log — SharePoint farm",
  description: "[SEED] Deployment log showing the out-of-band patch applied.",
  evidence_type: "log",
  collected_at: "2026-07-14",
  collected_by: "[SEED] Walkthrough Analyst",
  external_ref: null,
  created_at: "2026-07-14T00:00:00.000Z",
  updated_at: "2026-07-14T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
  vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
  api.getFinding.mockResolvedValue({
    finding: aFinding({
      id: "f-1",
      title: "[SEED] SharePoint RCE actively exploited",
      severity: "Critical",
      source_type: "cyber_signal",
      priority: "immediate",
      decision_state: "mitigating",
      status: "in_progress",
    }),
  });
  api.getFindingContext.mockResolvedValue(
    aFindingContext({
      finding: {
        id: "f-1",
        source_type: "cyber_signal",
        source_id: "sig-1",
        decision_state: "mitigating",
        operational_status: "in_progress",
      },
    })
  );
  api.getActionsForFinding.mockResolvedValue(
    anActionsResponse([
      anAction({ id: "a-1", title: "[SEED] Apply Microsoft out-of-band patch", status: "in_progress", priority: "immediate", due_date: "2026-07-22" }),
    ])
  );
  api.getTeamMembers.mockResolvedValue({
    members: [
      { id: "user-1", email: "analyst@example.com", name: "Walkthrough Analyst", role: "member", status: "active", created_at: "2026-01-01T00:00:00.000Z", last_used_at: null },
    ],
    pending_invites: [],
    seat_usage: { used: 1, max: 5 },
  });
  api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [seedEvidence] });
  api.getRiskAcceptancesForFinding.mockResolvedValue([]);
});

async function openRemediationAndAdd() {
  await renderPage(FindingDetailPage, props());
  fireEvent.click(screen.getByRole("tab", { name: "Remediation" }));
  await waitFor(() => expect(api.getFindingEvidence).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "+ Add Remediation Action" }));
  expect(screen.getByPlaceholderText("e.g. Patch vulnerable dependency")).toBeInTheDocument();
}

describe("REPRO: Add Action, seed-faithful F1", () => {
  it("F1 full: evidence + action + risk acceptance active", async () => {
    await openRemediationAndAdd();
  });

  it("no team members (owners empty)", async () => {
    api.getTeamMembers.mockResolvedValue(null);
    await openRemediationAndAdd();
  });

  it("valid evidence_type renders its humanized label unchanged", async () => {
    api.getFindingEvidence.mockResolvedValue({
      ok: true,
      evidence: [{ ...seedEvidence, evidence_type: "test_result" }],
    });
    await openRemediationAndAdd();
    // underscores → spaces, exactly as before the guard existed
    expect(screen.getByText(/test result/)).toBeInTheDocument();
  });

  it("a null evidence_type does not crash the page and does not hide the record", async () => {
    api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [{ ...seedEvidence, evidence_type: null }] });
    // Before the guard, FindingEvidenceSection threw on ev.evidence_type.replace(...)
    // and the entire finding detail page rendered blank. The page must survive:
    await openRemediationAndAdd();
    // the malformed record is still shown (title survives) with a safe fallback label
    expect(screen.getByText(seedEvidence.title)).toBeInTheDocument();
  });
});
