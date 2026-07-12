/**
 * /approvals — render contract for the executive approval queue (R2/R3).
 *
 * WHAT THIS FILE PROTECTS: separation of duties. The engine enforces SoD (409
 * `separation_of_duties`), approver authority (403 `approver_role_required`) and
 * read-only access — but an engine test cannot see a BUTTON. A rendered Approve
 * control offered to a user who cannot legally use it is a dead control and a
 * security-relevant lie: it invites an authorized-looking action that the server
 * will reject, and it tells the customer the wrong thing about who may decide.
 * The rule lives in the render (`canDecide = isApprover && !a.is_self_proposed`),
 * so only a render test can hold it.
 *
 * The three decision states are pinned too — the queue is deliberately
 * pending-only, and the approved/rejected OUTCOMES must never collapse into each
 * other (different rationale prompts, different confirm labels, different
 * destination states).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  apiKeyOnly,
  hrefs,
  hrefOf,
} from "@/test/harness";
import { aMe, anAuthMe, aPendingApproval } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getAuthMe: vi.fn(),
  getApprovalsServer: vi.fn(),
  decideRiskApproval: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import ApprovalsPage from "../page";

/** A plan proposed by SOMEONE ELSE — the only kind an approver may decide. */
const OTHERS = aPendingApproval({
  id: "ap-1",
  risk_id: "risk-1",
  risk_title: "Unencrypted backups in eu-west-1",
  requested_by_user_id: "user-2",
  is_self_proposed: false,
});

/** The SoD row: the engine says THIS caller proposed it. */
const MINE = aPendingApproval({
  id: "ap-2",
  risk_id: "risk-2",
  risk_title: "Vendor concentration in claims processing",
  kind: "risk_acceptance",
  requested_by_user_id: "user-1",
  residual_rating: "Critical",
  is_self_proposed: true,
});

/** A second decidable row, so the queue is not emptied by a single decision. */
const OTHERS_2 = aPendingApproval({
  id: "ap-3",
  risk_id: "risk-3",
  risk_title: "Third-party access review overdue",
  requested_by_user_id: "user-2",
  is_self_proposed: false,
});

const approve = () => screen.queryAllByRole("button", { name: "Approve" });
const reject = () => screen.queryAllByRole("button", { name: "Reject" });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.getAuthMe.mockResolvedValue(anAuthMe({ id: "user-1", role: "admin" }));
  api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [OTHERS] });
  api.decideRiskApproval.mockResolvedValue({ ok: true, lifecycle_state: "mitigation" });
});

describe("/approvals — separation of duties is rendered, not just enforced", () => {
  it("an approver gets Approve and Reject on a plan someone ELSE proposed", async () => {
    await renderPage(ApprovalsPage, {} as Record<string, never>);

    expect(approve()).toHaveLength(1);
    expect(reject()).toHaveLength(1);
  });

  it("an approver gets NO decision control on the plan THEY proposed (SoD)", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [MINE] });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    // The security contract: the engine would 409 this decision. Rendering the
    // button anyway would be a control the caller cannot legally use.
    expect(approve()).toHaveLength(0);
    expect(reject()).toHaveLength(0);

    // ...and the absence is EXPLAINED, not silent. A missing button with no reason
    // reads as a broken page; the customer must know why they cannot act.
    expect(container.textContent).toContain(
      "You proposed this — you can’t approve your own request (separation of duties)."
    );
  });

  it("SoD is per-row, not per-page: the approver may still decide the other rows", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [OTHERS, MINE] });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    // Exactly one decidable row out of two — the SoD row is suppressed on its own,
    // and does not disable (or leak into) the row the approver may lawfully decide.
    expect(approve()).toHaveLength(1);
    expect(reject()).toHaveLength(1);
    expect(container.textContent).toContain("separation of duties");
    expect(screen.getByText("Unencrypted backups in eu-west-1")).toBeInTheDocument();
    expect(screen.getByText("Vendor concentration in claims processing")).toBeInTheDocument();
  });

  it("a non-approver (member) sees the queue but gets no decision controls at all", async () => {
    api.getAuthMe.mockResolvedValue(anAuthMe({ id: "user-1", role: "member" }));

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    expect(approve()).toHaveLength(0);
    expect(reject()).toHaveLength(0);
    // The engine answers 403 `approver_role_required`; the UI must say so up front.
    expect(container.textContent).toContain(
      "You can review pending approvals, but only an approver (admin) can decide them."
    );
    // A read-only reviewer still gets the work — just not the decision.
    expect(screen.getByText("Unencrypted backups in eu-west-1")).toBeInTheDocument();
  });

  it("a viewer role is not an approver either — 'not admin' is the rule, not a denylist", async () => {
    api.getAuthMe.mockResolvedValue(anAuthMe({ id: "user-1", role: "viewer" }));

    await renderPage(ApprovalsPage, {} as Record<string, never>);

    expect(approve()).toHaveLength(0);
    expect(reject()).toHaveLength(0);
  });

  it("an API-key caller has no user identity, so it may not decide", async () => {
    apiKeyOnly();

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    // No JWT → getAuthMe is never asked → userRole is null → not an approver.
    // This matters: without a user identity the engine cannot compute SoD at all
    // (403 `actor_identity_required`), so a rendered Approve button would be a lie.
    expect(api.getAuthMe).not.toHaveBeenCalled();
    expect(approve()).toHaveLength(0);
    expect(container.textContent).toContain("only an approver (admin) can decide them");
  });

  it("an authMe failure degrades to NO approver rights, never to admin", async () => {
    api.getAuthMe.mockResolvedValue(null);

    await renderPage(ApprovalsPage, {} as Record<string, never>);

    // Fail closed: an unresolved role must not become a decision affordance.
    expect(approve()).toHaveLength(0);
    expect(reject()).toHaveLength(0);
  });
});

describe("/approvals — the three decision states never collapse into each other", () => {
  it("the queue is the PENDING population — it asks the engine for exactly that", async () => {
    await renderPage(ApprovalsPage, {} as Record<string, never>);

    // A queue that silently included decided approvals would offer Approve/Reject on
    // rows the engine will 409 as `approval_already_decided`.
    expect(api.getApprovalsServer).toHaveBeenCalledWith(expect.anything(), "pending");
  });

  it("APPROVING and REJECTING are visually distinct decisions, not one confirm button", async () => {
    await renderPage(ApprovalsPage, {} as Record<string, never>);

    fireEvent.click(approve()[0]);
    expect(screen.getByText("Approval rationale (required)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm approval" })).toBeInTheDocument();
    expect(screen.queryByText("Rejection rationale (required)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm rejection" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(reject()[0]);
    expect(screen.getByText("Rejection rationale (required)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm rejection" })).toBeInTheDocument();
    expect(screen.queryByText("Approval rationale (required)")).toBeNull();
  });

  it("no decision is committed without a rationale — the audit trail cannot be empty", async () => {
    await renderPage(ApprovalsPage, {} as Record<string, never>);

    fireEvent.click(approve()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(await screen.findByText("A rationale is required.")).toBeInTheDocument();
    expect(api.decideRiskApproval).not.toHaveBeenCalled();
    // The row stays in the queue — a refused submit is not a decision.
    expect(screen.getByText("Unencrypted backups in eu-west-1")).toBeInTheDocument();
  });

  it("APPROVED: commits the approval and tells the customer where the risk went", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [OTHERS, OTHERS_2] });

    await renderPage(ApprovalsPage, {} as Record<string, never>);

    fireEvent.click(approve()[0]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Compensating controls accepted by the CISO." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() =>
      expect(api.decideRiskApproval).toHaveBeenCalledWith("risk-1", "ap-1", {
        decision: "approved",
        comment: "Compensating controls accepted by the CISO.",
      })
    );
    expect(
      await screen.findByText(
        'Approved — "Unencrypted backups in eu-west-1" moved to Mitigation.'
      )
    ).toBeInTheDocument();
    // A decided approval leaves the pending queue.
    expect(screen.queryByText("Unencrypted backups in eu-west-1")).toBeNull();
  });

  it("REJECTED: a different decision, a different destination — never the approval copy", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [OTHERS, OTHERS_2] });

    await renderPage(ApprovalsPage, {} as Record<string, never>);

    fireEvent.click(reject()[0]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "The plan does not address the root cause." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));

    await waitFor(() =>
      expect(api.decideRiskApproval).toHaveBeenCalledWith("risk-1", "ap-1", {
        decision: "rejected",
        comment: "The plan does not address the root cause.",
      })
    );
    expect(
      await screen.findByText(
        'Rejected — "Unencrypted backups in eu-west-1" returned to Treatment Selection.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/moved to Mitigation/)).toBeNull();
    expect(screen.queryByText("Unencrypted backups in eu-west-1")).toBeNull();
  });

  /**
   * DEFECT, PINNED AS-IS (reported, not fixed): deciding the LAST pending approval
   * produces NO confirmation. ApprovalsQueue early-returns the empty state
   * (`if (approvals.length === 0) return …`) BEFORE it renders <Notice/>, so the
   * "Approved — … moved to Mitigation." toast is unmountable in exactly the case a
   * lone approver hits most often: an approvals queue usually has one item. The
   * decision DOES commit (the engine call below is asserted), but the customer is
   * shown only "No approvals pending." — indistinguishable from a no-op. This test
   * fails the day someone moves <Notice/> above the early return, which is the fix.
   */
  it("deciding the LAST approval commits, but shows no confirmation (known defect)", async () => {
    await renderPage(ApprovalsPage, {} as Record<string, never>);

    fireEvent.click(approve()[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Approved by CISO." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => expect(api.decideRiskApproval).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("No approvals pending.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/moved to Mitigation/)).toBeNull();
  });

  it("an engine SoD refusal (409) is surfaced in English and the row is NOT cleared", async () => {
    api.decideRiskApproval.mockResolvedValue({
      ok: false,
      error: "separation_of_duties",
      status: 409,
    });

    await renderPage(ApprovalsPage, {} as Record<string, never>);

    fireEvent.click(approve()[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Looks fine." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    // The engine is the authority: even if the UI let the click through (stale row,
    // is_self_proposed computed for a different caller), the refusal must be shown
    // as a refusal — not swallowed into a success toast.
    expect(
      await screen.findByText(
        "You proposed this plan, so you can't approve it (separation of duties)."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/moved to Mitigation/)).toBeNull();
    expect(screen.getByText("Unencrypted backups in eu-west-1")).toBeInTheDocument();
  });

  it("distinguishes a treatment plan from a risk acceptance — two different decisions", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [OTHERS, MINE] });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);
    const text = container.textContent ?? "";

    expect(text).toContain("Treatment plan");
    expect(text).toContain("Risk acceptance");
    // The wire enum must never surface.
    expect(text).not.toContain("risk_acceptance");
    expect(text).not.toContain("treatment_plan");
  });
});

describe("/approvals — every item deep-links to the thing being approved", () => {
  it("each row links to its risk, and the queue links back to the register", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [OTHERS, MINE] });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    // An approver must be able to open the risk before deciding it. A queue that
    // asks for a decision with no way to inspect the subject is not reviewable.
    expect(hrefOf(container, "Unencrypted backups in eu-west-1")).toBe("/risks/risk-1");
    expect(hrefOf(container, "Vendor concentration in claims processing")).toBe("/risks/risk-2");
    expect(hrefOf(container, "Risk Register")).toBe("/risks");
  });

  it("has no dead ends — no empty and no placeholder hrefs anywhere on the page", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [OTHERS, MINE] });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);
    const links = hrefs(container);

    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href).not.toBe("#");
      expect(href.trim()).not.toBe("");
    }
    // The SoD row still deep-links: being unable to DECIDE is not being unable to READ.
    expect(links).toContain("/risks/risk-2");
  });
});

describe("/approvals — empty and unavailable states are honest", () => {
  it("an empty queue explains what will land here — it is not a dead end", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [] });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    expect(screen.getByText("No approvals pending.")).toBeInTheDocument();
    expect(container.textContent).toContain(
      "Treatment plans submitted for approval will appear here."
    );
    // An empty queue offers no decision controls to press.
    expect(approve()).toHaveLength(0);
    expect(reject()).toHaveLength(0);
  });

  it("lifecycle-disabled (engine 404) is its OWN state — not 'nothing pending'", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: false, disabled: true, error: "http_404" });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    // The flag branch this page actually has: availability is server-decided (404),
    // not read from an env var. Telling an org with the workflow OFF that it has
    // "no approvals pending" would be a fake zero.
    expect(container.textContent).toContain(
      "The risk approval workflow isn’t enabled for your organization yet."
    );
    expect(screen.queryByText("No approvals pending.")).toBeNull();
    expect(approve()).toHaveLength(0);
  });

  it("a load failure is an ERROR, never an empty queue", async () => {
    api.getApprovalsServer.mockResolvedValue({
      ok: false,
      disabled: false,
      error: "network_error",
    });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    expect(screen.getByText("Could not load approvals.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("No approvals pending.");
    expect(container.textContent).not.toContain("isn’t enabled for your organization");
    expect(approve()).toHaveLength(0);
  });

  it("always renders the page's own promise, whatever the data state", async () => {
    api.getApprovalsServer.mockResolvedValue({ ok: true, approvals: [] });

    const { container } = await renderPage(ApprovalsPage, {} as Record<string, never>);

    expect(screen.getByRole("heading", { name: "Approvals" })).toBeInTheDocument();
    expect(container.textContent).toContain(
      "Treatment plans awaiting executive approval, org-wide."
    );
  });
});

describe("/approvals — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(ApprovalsPage, {} as Record<string, never>)).toBe("/login");
  });

  it("never asks the engine for approvals on behalf of a signed-out visitor", async () => {
    signedOut();
    await expectRedirect(ApprovalsPage, {} as Record<string, never>);
    expect(api.getApprovalsServer).not.toHaveBeenCalled();
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it("sends an unentitled (starter) caller to /dashboard, not into the queue", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));
    expect(await expectRedirect(ApprovalsPage, {} as Record<string, never>)).toBe("/dashboard");
    expect(api.getApprovalsServer).not.toHaveBeenCalled();
  });

  it("'professional' (Brief Pro) is not a platform tier — it gets the redirect too", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "professional" }));
    expect(await expectRedirect(ApprovalsPage, {} as Record<string, never>)).toBe("/dashboard");
  });

  it("a getMe() failure is treated as unentitled, not as platform access", async () => {
    api.getMe.mockResolvedValue(null);
    expect(await expectRedirect(ApprovalsPage, {} as Record<string, never>)).toBe("/dashboard");
  });

  it("entitlement comes from getMe, never from the session cookie", async () => {
    // The session claims platform; the authority (getMe) says starter. The engine
    // would 402 every call — the page must trust the engine, not the cookie.
    signedIn({ entitlementLevel: "platform" });
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "free" }));
    expect(await expectRedirect(ApprovalsPage, {} as Record<string, never>)).toBe("/dashboard");
  });

  it("a 'team' entitlement is admitted (the risk family's gate, not a platform-only gate)", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "team" }));
    await renderPage(ApprovalsPage, {} as Record<string, never>);
    expect(screen.getByRole("heading", { name: "Approvals" })).toBeInTheDocument();
  });
});
