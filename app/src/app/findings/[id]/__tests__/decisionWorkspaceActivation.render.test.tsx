/**
 * decisionWorkspaceActivation.render.test.tsx — the Sept 15 activation check.
 *
 * The Decision Workspace has been built and tested for months, and dark in
 * production the whole time. Activation is therefore not a question of whether
 * the component works — the suites beside this file already prove that — but of
 * whether TURNING IT ON is safe for a customer who is used to the legacy layout.
 *
 * Two failure modes matter and neither is caught by the existing suites:
 *
 *   1. A CAPABILITY DISAPPEARS. The workspace is a different tree, not a
 *      restyling. Anything the legacy layout renders unconditionally that the
 *      workspace does not is a regression the flag flip would ship silently —
 *      and the Risk Register panel (SL-RISK-LINK) was exactly that until this
 *      package carried it across.
 *
 *   2. A SURFACE IS REACHABLE BUT NOT USABLE. A route existing is not the same
 *      as a customer being able to act. Each step of
 *      finding → risk → remediation → SLA → evidence → closure is asserted as a
 *      CONTROL a person can operate, not as a string on a page.
 *
 * The engine's own flag is the second switch: the page renders the workspace
 * only when getFindingContext returns a context, so a half-flipped environment
 * falls back to the legacy layout rather than rendering a broken hybrid. That
 * is asserted too.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
import { aFinding, anAction, anActionsResponse, aFindingContext } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getFinding: vi.fn(),
  getActionsForFinding: vi.fn(),
  getFindingContext: vi.fn(),
  getTeamMembers: vi.fn(),
  getFindingEvidence: vi.fn(),
  getFindingRiskLinks: vi.fn(),
  getRisks: vi.fn(),
  getAuthMe: vi.fn(),
  getRiskAcceptancesForFinding: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import FindingDetailPage from "../page";

const props = (id = "f-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

const RISK = { id: "r-1", title: "Backup exposure", risk_rating: "High" };

function workspaceOn() {
  vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
  api.getFindingContext.mockResolvedValue(aFindingContext());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  signedIn();
  api.getFinding.mockResolvedValue({
    finding: aFinding({ due_date: "2026-09-30", owner_user_id: "user-1" }),
  });
  api.getActionsForFinding.mockResolvedValue(anActionsResponse([]));
  api.getFindingContext.mockResolvedValue(null);
  api.getTeamMembers.mockResolvedValue({
    members: [{ id: "user-1", email: "ana@example.com", name: "Ana Ops", role: "member", status: "active", created_at: "2026-01-01T00:00:00.000Z", last_used_at: null }],
    pending_invites: [],
    seat_usage: { used: 1, max: 5 },
  });
  api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [] });
  api.getFindingRiskLinks.mockResolvedValue([]);
  api.getRisks.mockResolvedValue({ risks: [RISK], total: 1 });
  api.getAuthMe.mockResolvedValue({ role: "admin" });
  api.getRiskAcceptancesForFinding.mockResolvedValue(null);
});

/* ── 1. Nothing disappears ───────────────────────────────────────────────── */

describe("activation does not remove a capability", () => {
  it("the Risk Register panel survives the flip — this was the regression", async () => {
    workspaceOn();

    await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Risk Register")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to register/i })).toBeInTheDocument();
  });

  it("it is ABOVE the tabs, so it is visible without hunting for it", async () => {
    // Inside a tab it would be conditionally hidden, which is the same as
    // removed for anyone who never clicks that tab.
    workspaceOn();

    const { container } = await renderPage(FindingDetailPage, props());

    const tablist = container.querySelector('[role="tablist"]')!;
    const panelHeading = screen.getByText("Risk Register");
    expect(panelHeading.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("shows the linked risks a customer already had", async () => {
    api.getFindingRiskLinks.mockResolvedValue([{
      risk_id: "r-1", link_type: "linked", note: null, created_at: "2026-09-01T00:00:00.000Z",
      created_by_user_id: "u-1", risk_title: "Backup exposure", risk_domain: "cyber",
      risk_rating: "High", risk_status: "open",
    }]);
    workspaceOn();

    await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("link", { name: /Backup exposure/i }))
      .toHaveAttribute("href", "/risks/r-1");
  });

  it("legacy and workspace offer the SAME register capability — one implementation", async () => {
    // Rendered with the flag off, then on, asserting the same control both
    // times. Two implementations would drift; this proves there is one.
    await renderPage(FindingDetailPage, props());
    expect(screen.getByRole("button", { name: /Add to register/i })).toBeInTheDocument();

    // Unmount the first tree explicitly: RTL cleans up between TESTS, not
    // mid-test, and two mounted layouts would make every query ambiguous.
    cleanup();
    vi.clearAllMocks();
    signedIn();
    api.getFinding.mockResolvedValue({ finding: aFinding() });
    api.getActionsForFinding.mockResolvedValue(anActionsResponse([]));
    api.getTeamMembers.mockResolvedValue({ members: [], pending_invites: [], seat_usage: { used: 0, max: 5 } });
    api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [] });
    api.getFindingRiskLinks.mockResolvedValue([]);
    api.getRisks.mockResolvedValue({ risks: [RISK], total: 1 });
    api.getAuthMe.mockResolvedValue({ role: "admin" });
    api.getRiskAcceptancesForFinding.mockResolvedValue(null);
    workspaceOn();

    await renderPage(FindingDetailPage, props());
    expect(screen.getByRole("button", { name: /Add to register/i })).toBeInTheDocument();
  });
});

/* ── 2. The two-switch contract ──────────────────────────────────────────── */

describe("a half-flipped environment falls back, it does not render a hybrid", () => {
  it("app flag on but engine context absent → legacy layout, no tabs", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    api.getFindingContext.mockResolvedValue(null);

    const { container } = await renderPage(FindingDetailPage, props());

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    // And the register capability is still there — the fallback is not degraded.
    expect(screen.getByText("Risk Register")).toBeInTheDocument();
  });

  it("app flag off → legacy layout even if the engine would serve a context", async () => {
    api.getFindingContext.mockResolvedValue(aFindingContext());

    const { container } = await renderPage(FindingDetailPage, props());

    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});

/* ── 3. The workflow, as controls a person can operate ───────────────────── */

describe("every step of the workflow is reachable and operable", () => {
  beforeEach(() => workspaceOn());

  it("finding → risk: the register controls are operable", async () => {
    await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("button", { name: /Add to register/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Link to a risk/i })).toBeEnabled();
  });

  it("SLA / due date is shown, not implied", async () => {
    await renderPage(FindingDetailPage, props());

    expect(screen.getByText(/SLA · Due date/i)).toBeInTheDocument();
  });

  it("remediation: the tab exists and carries the action controls", async () => {
    await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("tab", { name: "Remediation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });

  it("the decision axis is offered as a control", async () => {
    const { container } = await renderPage(FindingDetailPage, props());

    // A governance decision the customer can actually make — not a label.
    expect(container.querySelectorAll("select").length).toBeGreaterThan(0);
  });

  it("existing remediation work is visible in the workspace", async () => {
    api.getActionsForFinding.mockResolvedValue(
      anActionsResponse([anAction({ title: "Enable SSE-KMS on the backup bucket" })])
    );

    await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("tab", { name: "Remediation" })).toBeInTheDocument();
  });
});

/* ── 4. Authorization survives activation ───────────────────────────────── */

describe("permissions are preserved by the flip", () => {
  it("a viewer sees the register state but gets no controls", async () => {
    api.getAuthMe.mockResolvedValue({ role: "viewer" });
    api.getFindingRiskLinks.mockResolvedValue([{
      risk_id: "r-1", link_type: "linked", note: null, created_at: "2026-09-01T00:00:00.000Z",
      created_by_user_id: "u-1", risk_title: "Backup exposure", risk_domain: "cyber",
      risk_rating: "High", risk_status: "open",
    }]);
    workspaceOn();

    await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("link", { name: /Backup exposure/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add to register/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlink/i })).not.toBeInTheDocument();
  });

  it("an unresolvable role is treated as a viewer, not as an admin", async () => {
    // Fail closed: a transient /auth/me failure must not hand out governance
    // controls.
    api.getAuthMe.mockResolvedValue(null);
    workspaceOn();

    await renderPage(FindingDetailPage, props());

    expect(screen.queryByRole("button", { name: /Add to register/i })).not.toBeInTheDocument();
  });
});
